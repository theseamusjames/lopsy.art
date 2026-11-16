//! X-Trans demosaic: Frank Markesteijn's algorithm (the single-pass,
//! four-direction form of dcraw's `xtrans_interpolate`) in float, followed
//! by a correction for fine neutral detail.
//!
//! Green is estimated at every red and blue site four times, once along the
//! horizontal, the vertical and each diagonal, with filters that add the
//! high frequencies of the site's own colour. Red and blue are then filled
//! from colour differences against each of those four green planes, giving
//! four complete images. Per pixel, the directions whose image is locally
//! smoothest along its own direction are averaged.
//!
//! That vote covers a 7×7 neighbourhood, so it has no good answer where
//! structure changes direction within a few pixels (small text, stipple):
//! green lands on the wrong side of a stroke and the stroke turns purple or
//! green. `settle_row` repairs those places and only those; see there.
//!
//! The frame is processed in tiles so the working set stays in cache. Each
//! output pixel is a pure function of the mosaic within `REACH` pixels of
//! it, so tile placement never changes a result.

const R: usize = 0;
const G: usize = 1;
const B: usize = 2;

/// Pixels from the padded tile's edge at which the voted image is valid:
/// green 3, red/blue at the lone greens 2 more, the other colour at red/blue
/// sites 1 more, the green blocks 2 more, the derivative 1, the 3×3
/// homogeneity count 1 and the 5×5 vote 2.
const VOTED: usize = 12;

/// How far a pixel's result reaches into the mosaic: the voted image, the
/// 9-tap blur of its colour difference and that blur's slope. The blurred
/// gradient of `find_directionless` reaches one pixel less.
pub(super) const REACH: usize = VOTED + 4 + 2;

const TILE: usize = 240;
const STRIDE: usize = TILE + 2 * REACH;
const AREA: usize = STRIDE * STRIDE;
const DIRS: usize = 4;
const S: isize = STRIDE as isize;
const DIR_STEP: [isize; DIRS] = [1, S, S + 1, S - 1];

/// Smallest side with a mirror line inside the frame for both edges.
pub(super) const MIN_SIDE: usize = 6;

// Green filters, as fractions of 256: 174/-46 across two greens each side,
// 223/33/92 toward the lone green, 164/92/33 on a diagonal.
const ACROSS_NEAR: f32 = 174.0 / 256.0;
const ACROSS_FAR: f32 = 46.0 / 256.0;
const TOWARD_NEAR: f32 = 223.0 / 256.0;
const TOWARD_FAR: f32 = 33.0 / 256.0;
const TOWARD_OWN: f32 = 92.0 / 256.0;
const DIAG_NEAR: f32 = 164.0 / 256.0;
const DIAG_FAR: f32 = 92.0 / 256.0;
const DIAG_OWN: f32 = 33.0 / 256.0;

/// A direction counts as homogeneous at a pixel when its derivative is
/// within this factor of the best direction's.
const HOMOGENEITY_FACTOR: f32 = 8.0;

/// Votes one direction can collect: 5×5 pixels, each counting 3×3.
const FULL_VOTE: f32 = 225.0;

// The correction's three conditions, each a ramp from "applies fully" to
// "does not apply". Values were tuned on studio and street frames against
// reference decodes; the trade is cleaner small text against lost detail
// where colour really does change.

/// Share of `FULL_VOTE` won by the best direction. High means one direction
/// explains the neighbourhood (an edge, a flat area) and the vote stands.
const CONSISTENCY_RAMP: (f32, f32) = (0.6, 0.9);
/// Slope of the smooth colour difference, relative to luma: a colour edge.
const COLOUR_EDGE_RAMP: (f32, f32) = (0.10, 0.25);
/// Size of the smooth colour difference, relative to luma: a saturated area.
const SATURATION_RAMP: (f32, f32) = (0.15, 0.35);
/// Green disagreement, relative to green, below which a colour-difference
/// sample counts as fully sure.
const SURE_SPAN: f32 = 0.03;

// The correction also applies, whatever those three conditions say, where
// the vote's premise fails outright: the four greens disagree by much of
// the local brightness and the structure around has no single direction (a
// glyph a few pixels across). False colour there is dense enough to tint
// the smooth colour difference itself, so the colour-edge and saturation
// conditions, which read it, refuse exactly the pixels that most need the
// correction.

/// Largest green disagreement within two pixels, relative to luma.
const SPREAD_RAMP: (f32, f32) = (0.6, 0.9);
/// Coherence of the green gradient under the 9-tap blur: 0 where it points
/// every way, 1 along a single edge. An edge keeps its vote however much
/// the greens disagree across it.
const COHERENCE_RAMP: (f32, f32) = (0.6, 0.8);

/// A red or blue site. `toward` steps to the one green it touches that has
/// no green neighbour (the lone green); `across` is the perpendicular axis,
/// where it has two greens on each side.
#[derive(Clone, Copy)]
struct ColourSite {
    colour: usize,
    toward: isize,
    across: isize,
    across_plane: usize,
    diagonal: [isize; 2],
    diagonal_plane: [usize; 2],
}

/// Two sites along one direction that carry red and blue when a green-block
/// pixel is filled: equidistant, or one adjacent and one two steps away.
#[derive(Clone, Copy)]
struct Pair {
    near: isize,
    far: isize,
    is_symmetric: bool,
}

#[derive(Clone, Copy)]
enum Site {
    Colour(ColourSite),
    LoneGreen { horizontal: usize },
    BlockGreen([Pair; DIRS]),
}

/// What the algorithm needs to know about one 6×6 pattern.
pub(super) struct Layout {
    sites: [Site; 36],
    mirror_row: usize,
    mirror_col: usize,
}

impl Layout {
    /// `None` when the pattern does not have the X-Trans structure (a lone
    /// green in every 3×3 cell with red and blue on its four sides).
    pub(super) fn new(pattern: &[u8; 36]) -> Option<Self> {
        let colour = |r: i32, c: i32| pattern[(r.rem_euclid(6) * 6 + c.rem_euclid(6)) as usize] as usize;
        let is_lone = |r: i32, c: i32| {
            colour(r, c) == G
                && colour(r, c + 1) != G
                && colour(r, c - 1) != G
                && colour(r + 1, c) != G
                && colour(r - 1, c) != G
        };
        let offset = |dr: i32, dc: i32| dr as isize * S + dc as isize;

        let mut sites = [Site::LoneGreen { horizontal: R }; 36];
        for r in 0..6i32 {
            for c in 0..6i32 {
                let own = colour(r, c);
                let at = |dr: i32, dc: i32| colour(r + dr, c + dc);
                let site = if is_lone(r, c) {
                    let horizontal = at(0, 1);
                    let vertical = 2 - horizontal;
                    let fits = at(0, -1) == horizontal
                        && at(0, 2) == vertical
                        && at(0, -2) == vertical
                        && at(1, 0) == vertical
                        && at(-1, 0) == vertical
                        && at(2, 0) == horizontal
                        && at(-2, 0) == horizontal;
                    if !fits {
                        return None;
                    }
                    Site::LoneGreen { horizontal }
                } else if own == G {
                    let is_carrier = |dr: i32, dc: i32| at(dr, dc) != G || is_lone(r + dr, c + dc);
                    let mut pairs = [Pair { near: 0, far: 0, is_symmetric: true }; DIRS];
                    for (d, (ur, uc)) in [(0, 1), (1, 0), (1, 1), (1, -1)].into_iter().enumerate() {
                        pairs[d] = if is_carrier(ur, uc) && is_carrier(-ur, -uc) {
                            Pair { near: offset(ur, uc), far: offset(-ur, -uc), is_symmetric: true }
                        } else if is_carrier(ur, uc) && is_carrier(-2 * ur, -2 * uc) {
                            Pair { near: offset(ur, uc), far: offset(-2 * ur, -2 * uc), is_symmetric: false }
                        } else if is_carrier(-ur, -uc) && is_carrier(2 * ur, 2 * uc) {
                            Pair { near: offset(-ur, -uc), far: offset(2 * ur, 2 * uc), is_symmetric: false }
                        } else {
                            return None;
                        };
                    }
                    Site::BlockGreen(pairs)
                } else {
                    let mut toward = None;
                    for (dr, dc) in [(0, 1), (0, -1), (1, 0), (-1, 0)] {
                        if is_lone(r + dr, c + dc) {
                            if toward.is_some() {
                                return None;
                            }
                            toward = Some((dr, dc));
                        }
                    }
                    let (sr, sc) = toward?;
                    let (tr, tc) = if sr == 0 { (1, 0) } else { (0, 1) };
                    let other = 2 - own;
                    let diagonals = [(-sr + tr, -sc + tc), (-sr - tr, -sc - tc)];
                    let mut fits = at(tr, tc) == G
                        && at(-tr, -tc) == G
                        && at(2 * tr, 2 * tc) == G
                        && at(-2 * tr, -2 * tc) == G
                        && at(-2 * sr, -2 * sc) == G
                        && at(2 * sr, 2 * sc) == own
                        && at(-sr, -sc) == other
                        && at(3 * tr, 3 * tc) == other
                        && at(-3 * tr, -3 * tc) == other;
                    for (dr, dc) in diagonals {
                        fits = fits
                            && at(dr, dc) == G
                            && at(-2 * dr, -2 * dc) == G
                            && at(3 * dr, 3 * dc) == own
                            && at(-3 * dr, -3 * dc) == own;
                    }
                    if !fits {
                        return None;
                    }
                    let plane_of = |(dr, dc): (i32, i32)| if dr * dc > 0 { 2 } else { 3 };
                    Site::Colour(ColourSite {
                        colour: own,
                        toward: offset(sr, sc),
                        across: offset(tr, tc),
                        across_plane: if tr == 0 { 0 } else { 1 },
                        diagonal: [offset(diagonals[0].0, diagonals[0].1), offset(diagonals[1].0, diagonals[1].1)],
                        diagonal_plane: [plane_of(diagonals[0]), plane_of(diagonals[1])],
                    })
                };
                sites[(r * 6 + c) as usize] = site;
            }
        }

        // The pattern mirrors onto itself about the lines through the lone
        // greens; padding by that mirror keeps every colour in place.
        let mirror_col = (0..3).find(|&a| (0..6).all(|r| (0..6).all(|c| colour(r, 2 * a - c) == colour(r, c))))?;
        let mirror_row = (0..3).find(|&a| (0..6).all(|r| (0..6).all(|c| colour(2 * a - r, c) == colour(r, c))))?;
        Some(Self { sites, mirror_row: mirror_row as usize, mirror_col: mirror_col as usize })
    }

    #[inline]
    fn site(&self, row: usize, col: usize) -> &Site {
        &self.sites[(row % 6) * 6 + col % 6]
    }
}

/// Reflects an out-of-range coordinate about the pattern mirror lines
/// nearest each end of `0..len`, as often as it takes to land inside.
fn mirror(x: isize, len: usize, phase: usize) -> usize {
    let last = len as isize - 1;
    let low_axis = phase as isize;
    let high_axis = low_axis + 3 * ((last - low_axis) / 3);
    if high_axis <= low_axis {
        return x.clamp(0, last) as usize;
    }
    let mut x = x;
    while x < 0 || x > last {
        x = if x < 0 { 2 * low_axis - x } else { 2 * high_axis - x };
    }
    x as usize
}

struct Scratch {
    mosaic: Vec<f32>,
    /// Four directions × three channels, each a `STRIDE`-wide plane.
    planes: Vec<f32>,
    luma: Vec<f32>,
    blue_diff: Vec<f32>,
    red_diff: Vec<f32>,
    derivative: Vec<f32>,
    homogeneity: Vec<u8>,
    row_votes: Vec<u16>,
    /// The voted image, one plane per channel.
    voted: Vec<f32>,
    /// Share of the votes the best direction won.
    consistency: Vec<f32>,
    /// Disagreement of the four green estimates at red and blue sites.
    span: Vec<f32>,
    /// Weighted red-minus-green and blue-minus-green samples, their weights,
    /// and the weighted means.
    weighted_chroma: [Vec<f32>; 2],
    weight: Vec<f32>,
    weight_smooth: Vec<f32>,
    chroma_smooth: [Vec<f32>; 2],
    green_smooth: Vec<f32>,
    /// Products of the voted green's gradient (xx, xy, yy) and their blurs.
    gradient: [Vec<f32>; 3],
    gradient_smooth: [Vec<f32>; 3],
    /// How far the correction applies regardless of its other conditions.
    directionless: Vec<f32>,
    blur_rows: Vec<f32>,
    columns: Vec<usize>,
}

impl Scratch {
    fn new() -> Self {
        let plane = || vec![0.0f32; AREA];
        Self {
            mosaic: plane(),
            planes: vec![0.0; DIRS * 3 * AREA],
            luma: plane(),
            blue_diff: plane(),
            red_diff: plane(),
            derivative: vec![0.0; DIRS * AREA],
            homogeneity: vec![0; DIRS * AREA],
            row_votes: vec![0; DIRS * AREA],
            voted: vec![0.0; 3 * AREA],
            consistency: plane(),
            span: plane(),
            weighted_chroma: [plane(), plane()],
            weight: plane(),
            weight_smooth: plane(),
            chroma_smooth: [plane(), plane()],
            green_smooth: plane(),
            gradient: [plane(), plane(), plane()],
            gradient_smooth: [plane(), plane(), plane()],
            directionless: plane(),
            blur_rows: plane(),
            columns: vec![0; STRIDE],
        }
    }
}

#[inline]
fn plane(direction: usize, channel: usize) -> usize {
    (direction * 3 + channel) * AREA
}

#[inline]
fn shifted(index: usize, by: isize) -> usize {
    (index as isize + by) as usize
}

/// Demosaics a white-balanced X-Trans mosaic to interleaved RGB.
pub(super) fn demosaic(raw: &[f32], w: usize, h: usize, layout: &Layout) -> Vec<f32> {
    let mut out = vec![0.0f32; w * h * 3];
    let mut scratch = Scratch::new();
    for top in (0..h).step_by(TILE) {
        let rows = TILE.min(h - top);
        for left in (0..w).step_by(TILE) {
            let cols = TILE.min(w - left);
            load_tile(raw, w, h, layout, top, left, rows, cols, &mut scratch);
            let (padded_rows, padded_cols) = (rows + 2 * REACH, cols + 2 * REACH);
            interpolate_green(layout, padded_rows, padded_cols, &mut scratch);
            fill_lone_greens(layout, padded_rows, padded_cols, &mut scratch);
            fill_other_colour(layout, padded_rows, padded_cols, &mut scratch);
            fill_green_blocks(layout, padded_rows, padded_cols, &mut scratch);
            score_directions(padded_rows, padded_cols, &mut scratch);
            vote(padded_rows, padded_cols, &mut scratch);
            weigh_chroma(layout, padded_rows, padded_cols, &mut scratch);
            smooth_chroma(padded_rows, padded_cols, &mut scratch);
            find_directionless(padded_rows, padded_cols, &mut scratch);
            for row in 0..rows {
                let out_row = &mut out[((top + row) * w + left) * 3..][..cols * 3];
                settle_row(layout, &scratch, row + REACH, cols, out_row);
            }
        }
    }
    out
}

#[allow(clippy::too_many_arguments)]
fn load_tile(
    raw: &[f32],
    w: usize,
    h: usize,
    layout: &Layout,
    top: usize,
    left: usize,
    rows: usize,
    cols: usize,
    scratch: &mut Scratch,
) {
    let padded_cols = cols + 2 * REACH;
    for (pc, column) in scratch.columns[..padded_cols].iter_mut().enumerate() {
        *column = mirror(left as isize + pc as isize - REACH as isize, w, layout.mirror_col);
    }
    for pr in 0..rows + 2 * REACH {
        let source = mirror(top as isize + pr as isize - REACH as isize, h, layout.mirror_row) * w;
        let base = pr * STRIDE;
        for pc in 0..padded_cols {
            let value = raw[source + scratch.columns[pc]];
            let index = base + pc;
            scratch.mosaic[index] = value;
            let channel = match layout.site(pr, pc) {
                Site::Colour(site) => site.colour,
                _ => G,
            };
            for direction in 0..DIRS {
                scratch.planes[plane(direction, channel) + index] = value;
            }
        }
    }
}

fn interpolate_green(layout: &Layout, rows: usize, cols: usize, scratch: &mut Scratch) {
    let mosaic = &scratch.mosaic;
    let planes = &mut scratch.planes;
    for pr in 3..rows - 3 {
        for pc in 3..cols - 3 {
            let Site::Colour(site) = layout.site(pr, pc) else { continue };
            let index = pr * STRIDE + pc;
            let m = |by: isize| mosaic[shifted(index, by)];
            let own = m(0);
            let (toward, across) = (site.toward, site.across);

            let ring = [m(across), m(-across), m(toward), m(-2 * toward), m(site.diagonal[0]), m(site.diagonal[1])];
            let low = ring.iter().copied().fold(f32::INFINITY, f32::min);
            let high = ring.iter().copied().fold(f32::NEG_INFINITY, f32::max);

            let along_across =
                ACROSS_NEAR * (m(across) + m(-across)) - ACROSS_FAR * (m(2 * across) + m(-2 * across));
            let along_toward =
                TOWARD_NEAR * m(toward) + TOWARD_FAR * m(-2 * toward) + TOWARD_OWN * (own - m(2 * toward));
            planes[plane(site.across_plane, G) + index] = along_across.clamp(low, high);
            planes[plane(1 - site.across_plane, G) + index] = along_toward.clamp(low, high);
            for k in 0..2 {
                let d = site.diagonal[k];
                let value = DIAG_NEAR * m(d) + DIAG_FAR * m(-2 * d) + DIAG_OWN * (2.0 * own - m(3 * d) - m(-3 * d));
                planes[plane(site.diagonal_plane[k], G) + index] = value.clamp(low, high);
            }
        }
    }
}

/// One colour at a lone green from the two same-colour sites `step` away on
/// either side, corrected by the green curvature. Returns the value and how
/// badly that pair fits (large when colour and green disagree across it).
#[inline]
fn across_pair(mosaic: &[f32], green: &[f32], index: usize, step: isize, centre: f32) -> (f32, f32) {
    let (a, b) = (shifted(index, step), shifted(index, -step));
    let curvature = 2.0 * centre - green[a] - green[b];
    let slope = green[a] - green[b] - mosaic[a] + mosaic[b];
    (0.5 * (mosaic[a] + mosaic[b] + curvature), slope * slope + curvature * curvature)
}

fn fill_lone_greens(layout: &Layout, rows: usize, cols: usize, scratch: &mut Scratch) {
    let mosaic = &scratch.mosaic;
    for pr in 5..rows - 5 {
        for pc in 5..cols - 5 {
            let Site::LoneGreen { horizontal } = *layout.site(pr, pc) else { continue };
            let vertical = 2 - horizontal;
            let index = pr * STRIDE + pc;
            let centre = mosaic[index];
            for direction in 0..DIRS {
                let green = &scratch.planes[plane(direction, G)..][..AREA];
                let (h_near, h_near_fit) = across_pair(mosaic, green, index, 1, centre);
                let (h_far, h_far_fit) = across_pair(mosaic, green, index, 2, centre);
                let (v_near, v_near_fit) = across_pair(mosaic, green, index, S, centre);
                let (v_far, v_far_fit) = across_pair(mosaic, green, index, 2 * S, centre);
                let use_row = match direction {
                    0 => true,
                    1 => false,
                    _ => h_near_fit + h_far_fit < v_near_fit + v_far_fit,
                };
                let (h_value, v_value) = if use_row { (h_near, h_far) } else { (v_far, v_near) };
                scratch.planes[plane(direction, horizontal) + index] = h_value.max(0.0);
                scratch.planes[plane(direction, vertical) + index] = v_value.max(0.0);
            }
        }
    }
}

fn fill_other_colour(layout: &Layout, rows: usize, cols: usize, scratch: &mut Scratch) {
    for pr in 6..rows - 6 {
        for pc in 6..cols - 6 {
            let Site::Colour(site) = layout.site(pr, pc) else { continue };
            let other = 2 - site.colour;
            let index = pr * STRIDE + pc;
            let far = 3 * site.across;
            for direction in 0..DIRS {
                let green_base = plane(direction, G);
                let other_base = plane(direction, other);
                let planes = &scratch.planes;
                let green = |by: isize| planes[green_base + shifted(index, by)];
                let centre = green(0);
                let spread = |by: isize| (centre - green(by)).abs() + (centre - green(-by)).abs();
                let step = if direction == site.across_plane && spread(site.toward) >= 2.0 * spread(far) {
                    far
                } else {
                    site.toward
                };
                let carried = planes[other_base + shifted(index, step)] + planes[other_base + shifted(index, -step)];
                let value = 0.5 * (carried + 2.0 * centre - green(step) - green(-step));
                scratch.planes[other_base + index] = value.max(0.0);
            }
        }
    }
}

fn fill_green_blocks(layout: &Layout, rows: usize, cols: usize, scratch: &mut Scratch) {
    for pr in 8..rows - 8 {
        for pc in 8..cols - 8 {
            let Site::BlockGreen(pairs) = layout.site(pr, pc) else { continue };
            let index = pr * STRIDE + pc;
            let centre = scratch.mosaic[index];
            for (direction, pair) in pairs.iter().enumerate() {
                let green_base = plane(direction, G);
                let (near, far) = (shifted(index, pair.near), shifted(index, pair.far));
                let (green_near, green_far) = (scratch.planes[green_base + near], scratch.planes[green_base + far]);
                for channel in [R, B] {
                    let base = plane(direction, channel);
                    let (c_near, c_far) = (scratch.planes[base + near], scratch.planes[base + far]);
                    let value = if pair.is_symmetric {
                        0.5 * (2.0 * centre - green_near - green_far + c_near + c_far)
                    } else {
                        (3.0 * centre - 2.0 * green_near - green_far + 2.0 * c_near + c_far) / 3.0
                    };
                    scratch.planes[base + index] = value.max(0.0);
                }
            }
        }
    }
}

/// For each direction: the squared second derivative of luma and the two
/// colour differences along it, how many of a pixel's 3×3 neighbours stay
/// within `HOMOGENEITY_FACTOR` of the pixel's best direction, and those
/// counts summed along rows ready for the 5×5 vote.
fn score_directions(rows: usize, cols: usize, scratch: &mut Scratch) {
    for (direction, step) in DIR_STEP.into_iter().enumerate() {
        let red = &scratch.planes[plane(direction, R)..][..AREA];
        let green = &scratch.planes[plane(direction, G)..][..AREA];
        let blue = &scratch.planes[plane(direction, B)..][..AREA];
        for pr in 8..rows - 8 {
            for index in pr * STRIDE + 8..pr * STRIDE + cols - 8 {
                let luma = 0.25 * red[index] + 0.5 * green[index] + 0.25 * blue[index];
                scratch.luma[index] = luma;
                scratch.blue_diff[index] = blue[index] - luma;
                scratch.red_diff[index] = red[index] - luma;
            }
        }
        let derivative = &mut scratch.derivative[direction * AREA..][..AREA];
        for pr in 9..rows - 9 {
            for index in pr * STRIDE + 9..pr * STRIDE + cols - 9 {
                let (a, b) = (shifted(index, step), shifted(index, -step));
                let second = |p: &[f32]| 2.0 * p[index] - p[a] - p[b];
                let (y, u, v) = (second(&scratch.luma), second(&scratch.blue_diff), second(&scratch.red_diff));
                derivative[index] = y * y + u * u + v * v;
            }
        }
    }

    for pr in 10..rows - 10 {
        for index in pr * STRIDE + 10..pr * STRIDE + cols - 10 {
            let mut best = f32::INFINITY;
            for direction in 0..DIRS {
                best = best.min(scratch.derivative[direction * AREA + index]);
            }
            let limit = best * HOMOGENEITY_FACTOR;
            for direction in 0..DIRS {
                let derivative = &scratch.derivative[direction * AREA..][..AREA];
                let mut count = 0u8;
                for row_step in [-S, 0, S] {
                    let centre = shifted(index, row_step);
                    count += (derivative[centre - 1] <= limit) as u8
                        + (derivative[centre] <= limit) as u8
                        + (derivative[centre + 1] <= limit) as u8;
                }
                scratch.homogeneity[direction * AREA + index] = count;
            }
        }
    }

    for direction in 0..DIRS {
        let homogeneity = &scratch.homogeneity[direction * AREA..][..AREA];
        let row_votes = &mut scratch.row_votes[direction * AREA..][..AREA];
        for pr in 10..rows - 10 {
            for index in pr * STRIDE + VOTED..pr * STRIDE + cols - VOTED {
                row_votes[index] = homogeneity[index - 2..=index + 2].iter().map(|&v| v as u16).sum();
            }
        }
    }
}

/// Averages, per pixel, the directions whose 5×5 vote is within an eighth
/// of the best.
fn vote(rows: usize, cols: usize, scratch: &mut Scratch) {
    for pr in VOTED..rows - VOTED {
        for index in pr * STRIDE + VOTED..pr * STRIDE + cols - VOTED {
            let mut votes = [0u16; DIRS];
            for (direction, vote) in votes.iter_mut().enumerate() {
                let row_votes = &scratch.row_votes[direction * AREA..][..AREA];
                *vote = (-2..=2).map(|k| row_votes[shifted(index, k * S)]).sum();
            }
            let best = votes.into_iter().max().unwrap_or(0);
            let threshold = best - (best >> 3);
            let mut sum = [0.0f32; 3];
            let mut count = 0.0f32;
            for (direction, &vote) in votes.iter().enumerate() {
                if vote >= threshold {
                    for (channel, total) in sum.iter_mut().enumerate() {
                        *total += scratch.planes[plane(direction, channel) + index];
                    }
                    count += 1.0;
                }
            }
            for (channel, total) in sum.into_iter().enumerate() {
                scratch.voted[channel * AREA + index] = total / count;
            }
            scratch.consistency[index] = best as f32 / FULL_VOTE;
        }
    }
}

/// Colour-difference samples for the smooth estimate, weighted down where
/// the four green estimates disagree, since that is where the voted green
/// (and so the difference) is unsure. A green site takes the disagreement of
/// the red and blue sites beside it, whose greens its own colours came from.
fn weigh_chroma(layout: &Layout, rows: usize, cols: usize, scratch: &mut Scratch) {
    for pr in VOTED - 1..rows - VOTED + 1 {
        for pc in VOTED - 1..cols - VOTED + 1 {
            let index = pr * STRIDE + pc;
            scratch.span[index] = match layout.site(pr, pc) {
                Site::Colour(_) => {
                    let (low, high) = green_span(&scratch.planes, index);
                    high - low
                }
                _ => 0.0,
            };
        }
    }
    let span = &scratch.span;
    for pr in VOTED..rows - VOTED {
        for pc in VOTED..cols - VOTED {
            let index = pr * STRIDE + pc;
            let disagreement = match layout.site(pr, pc) {
                Site::Colour(_) => span[index],
                _ => span[index - 1].max(span[index + 1]).max(span[index - STRIDE]).max(span[index + STRIDE]),
            };
            let green = scratch.voted[AREA + index];
            let unsure = disagreement + SURE_SPAN * (green.max(0.0) + 0.01);
            let weight = 1.0 / (unsure * unsure);
            scratch.weighted_chroma[0][index] = weight * (scratch.voted[index] - green);
            scratch.weighted_chroma[1][index] = weight * (scratch.voted[2 * AREA + index] - green);
            scratch.weight[index] = weight;
        }
    }
}

/// Lowest and highest of the four directional greens at one site.
#[inline]
fn green_span(planes: &[f32], index: usize) -> (f32, f32) {
    let mut low = f32::INFINITY;
    let mut high = f32::NEG_INFINITY;
    for direction in 0..DIRS {
        let candidate = planes[plane(direction, G) + index];
        low = low.min(candidate);
        high = high.max(candidate);
    }
    (low, high)
}

const BINOMIAL_9: [f32; 9] = [1.0, 8.0, 28.0, 56.0, 70.0, 56.0, 28.0, 8.0, 1.0];

/// 9-tap binomial blur each way. `source` must be valid `inset` pixels in
/// from the padded edge; `smooth` is then valid at `inset + 4`.
fn blur9(source: &[f32], rows_blurred: &mut [f32], smooth: &mut [f32], rows: usize, cols: usize, inset: usize) {
    for pr in inset..rows - inset {
        for index in pr * STRIDE + inset + 4..pr * STRIDE + cols - inset - 4 {
            let taps = &source[index - 4..=index + 4];
            rows_blurred[index] = taps.iter().zip(BINOMIAL_9).map(|(v, w)| v * w).sum::<f32>() / 256.0;
        }
    }
    for pr in inset + 4..rows - inset - 4 {
        for index in pr * STRIDE + inset + 4..pr * STRIDE + cols - inset - 4 {
            let mut total = 0.0f32;
            for (tap, weight) in BINOMIAL_9.into_iter().enumerate() {
                total += rows_blurred[shifted(index, (tap as isize - 4) * S)] * weight;
            }
            smooth[index] = total / 256.0;
        }
    }
}

/// The local colour difference as a weighted mean of the samples, and a
/// blurred green to measure it against.
fn smooth_chroma(rows: usize, cols: usize, scratch: &mut Scratch) {
    blur9(&scratch.weight, &mut scratch.blur_rows, &mut scratch.weight_smooth, rows, cols, VOTED);
    for k in 0..2 {
        blur9(&scratch.weighted_chroma[k], &mut scratch.blur_rows, &mut scratch.chroma_smooth[k], rows, cols, VOTED);
        for pr in VOTED + 4..rows - VOTED - 4 {
            for index in pr * STRIDE + VOTED + 4..pr * STRIDE + cols - VOTED - 4 {
                scratch.chroma_smooth[k][index] /= scratch.weight_smooth[index];
            }
        }
    }
    blur9(&scratch.voted[AREA..2 * AREA], &mut scratch.blur_rows, &mut scratch.green_smooth, rows, cols, VOTED);
}

/// The brightness the correction measures differences against.
#[inline]
fn brightness(scratch: &Scratch, index: usize) -> f32 {
    scratch.green_smooth[index].max(0.0) + 0.01
}

/// Marks where the vote had nothing to go on: the directional greens
/// disagree by much of the local brightness, and the gradient of the voted
/// green, gathered over the blur, has no dominant direction. Its coherence
/// is the relative gap between the two eigenvalues of the blurred gradient
/// products (the structure tensor).
///
/// The gradient needs one pixel more of the voted image than the blur's
/// own inset, so the blurred products are valid `VOTED + 5` pixels in. They
/// are only built for a tile that has disagreement somewhere to judge.
fn find_directionless(rows: usize, cols: usize, scratch: &mut Scratch) {
    for pr in REACH - 2..rows - REACH + 2 {
        for index in pr * STRIDE + REACH..pr * STRIDE + cols - REACH {
            scratch.blur_rows[index] = scratch.span[index - 2..=index + 2].iter().copied().fold(0.0, f32::max);
        }
    }
    let mut any = false;
    for pr in REACH..rows - REACH {
        for index in pr * STRIDE + REACH..pr * STRIDE + cols - REACH {
            let spread = (-2..=2).map(|row| scratch.blur_rows[shifted(index, row * S)]).fold(0.0, f32::max);
            let disagreement = ramp(spread / brightness(scratch, index), SPREAD_RAMP);
            scratch.directionless[index] = disagreement;
            any |= disagreement > 0.0;
        }
    }
    if !any {
        return;
    }
    let green = &scratch.voted[AREA..2 * AREA];
    for pr in VOTED + 1..rows - VOTED - 1 {
        for index in pr * STRIDE + VOTED + 1..pr * STRIDE + cols - VOTED - 1 {
            let across = green[index + 1] - green[index - 1];
            let down = green[index + STRIDE] - green[index - STRIDE];
            scratch.gradient[0][index] = across * across;
            scratch.gradient[1][index] = across * down;
            scratch.gradient[2][index] = down * down;
        }
    }
    for k in 0..3 {
        blur9(&scratch.gradient[k], &mut scratch.blur_rows, &mut scratch.gradient_smooth[k], rows, cols, VOTED + 1);
    }
    let [xx, xy, yy] = &scratch.gradient_smooth;
    for pr in REACH..rows - REACH {
        for index in pr * STRIDE + REACH..pr * STRIDE + cols - REACH {
            if scratch.directionless[index] > 0.0 {
                let gap = (xx[index] - yy[index]).hypot(2.0 * xy[index]);
                let coherence = gap / (xx[index] + yy[index] + f32::MIN_POSITIVE);
                scratch.directionless[index] *= 1.0 - ramp(coherence, COHERENCE_RAMP);
            }
        }
    }
}

#[inline]
fn ramp(value: f32, (from, to): (f32, f32)) -> f32 {
    ((value - from) / (to - from)).clamp(0.0, 1.0)
}

/// Writes one output row, correcting the voted image where the vote had no
/// consistent direction and the local colour difference is small and even
/// (neutral fine detail), and wherever `find_directionless` says the vote
/// had nothing to go on. There the smooth colour difference is trusted
/// over the per-pixel one: at a red or blue site green moves toward what
/// the site's own sample implies under it, but never outside the span of
/// the four directional greens, so it stays an interpolation of measured
/// greens and takes on none of the sample's noise in flat areas; red and
/// blue then follow the smooth difference.
///
/// Elsewhere the voted image stands. In particular an edge with lateral
/// chromatic aberration keeps its fringe: the colour planes really are
/// displaced there, and forcing them together blurs the edge.
fn settle_row(layout: &Layout, scratch: &Scratch, padded_row: usize, cols: usize, out: &mut [f32]) {
    let [smooth_red, smooth_blue] = &scratch.chroma_smooth;
    for col in 0..cols {
        let index = padded_row * STRIDE + col + REACH;
        let mut rgb = [scratch.voted[index], scratch.voted[AREA + index], scratch.voted[2 * AREA + index]];
        let site = layout.site(padded_row, col + REACH);
        let own = match site {
            Site::Colour(site) => site.colour,
            _ => G,
        };
        // Averaging equal floats need not return them; the measured sample is exact.
        rgb[own] = scratch.mosaic[index];
        let mut trust = 1.0 - ramp(scratch.consistency[index], CONSISTENCY_RAMP);
        if trust > 0.0 {
            let luma = brightness(scratch, index);
            let slope = |p: &[f32]| (p[index + 2] - p[index - 2]).hypot(p[index + 2 * STRIDE] - p[index - 2 * STRIDE]);
            let edge = slope(smooth_red).max(slope(smooth_blue)) / luma;
            let saturation = smooth_red[index].hypot(smooth_blue[index]) / luma;
            trust *= (1.0 - ramp(edge, COLOUR_EDGE_RAMP)) * (1.0 - ramp(saturation, SATURATION_RAMP));
        }
        let trust = trust.max(scratch.directionless[index]);
        if trust > 0.0 {
            let voted_green = rgb[G];
            if let Site::Colour(site) = site {
                let smooth = if site.colour == R { smooth_red } else { smooth_blue };
                let implied = scratch.mosaic[index] - smooth[index];
                let (low, high) = green_span(&scratch.planes, index);
                rgb[G] = voted_green + trust * (implied.clamp(low, high) - voted_green);
            }
            for (channel, smooth) in [(R, smooth_red), (B, smooth_blue)] {
                if channel != own {
                    let difference = rgb[channel] - voted_green;
                    rgb[channel] = (rgb[G] + difference + trust * (smooth[index] - difference)).max(0.0);
                }
            }
        }
        out[col * 3..col * 3 + 3].copy_from_slice(&rgb);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PATTERN: [u8; 36] = [
        1, 0, 2, 1, 2, 0,
        2, 1, 1, 0, 1, 1,
        0, 1, 1, 2, 1, 1,
        1, 2, 0, 1, 0, 2,
        0, 1, 1, 2, 1, 1,
        2, 1, 1, 0, 1, 1,
    ];

    fn shifted_pattern(rows: usize, cols: usize) -> [u8; 36] {
        let mut out = [0u8; 36];
        for r in 0..6 {
            for c in 0..6 {
                out[r * 6 + c] = PATTERN[((r + rows) % 6) * 6 + (c + cols) % 6];
            }
        }
        out
    }

    fn noise(w: usize, h: usize, seed: u32) -> Vec<f32> {
        let mut state = seed;
        (0..w * h)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                (state % 1000) as f32 / 1000.0
            })
            .collect()
    }

    /// Light rings five pixels across on a dark ground, every 11 pixels so
    /// they fall on each phase of the pattern. Neutral: one value per pixel.
    fn rings(w: usize, h: usize) -> Vec<f32> {
        (0..w * h)
            .map(|i| {
                let mut cover = 0.0;
                for sub in 0..16 {
                    let y = (i / w) as f32 + (sub / 4) as f32 / 4.0 + 0.125;
                    let x = (i % w) as f32 + (sub % 4) as f32 / 4.0 + 0.125;
                    let (dy, dx) = (y.rem_euclid(11.0) - 5.5, x.rem_euclid(11.0) - 5.5);
                    if (dx.hypot(dy) - 2.5).abs() < 0.7 {
                        cover += 1.0 / 16.0;
                    }
                }
                0.02 + 0.08 * cover
            })
            .collect()
    }

    #[test]
    fn neutral_glyphs_a_few_pixels_across_stay_neutral() {
        let (w, h) = (132, 132);
        let scene = rings(w, h);
        let rgb = demosaic(&scene, w, h, &Layout::new(&PATTERN).unwrap());
        let error: f32 = rgb
            .chunks_exact(3)
            .zip(&scene)
            .map(|(pixel, value)| pixel.iter().map(|channel| (channel - value).abs()).sum::<f32>() / (value + 0.01))
            .sum();
        // The vote alone leaves 0.048: its false colour tints the smooth colour
        // difference, and the colour-edge and saturation conditions then refuse it.
        let mean = error / (w * h) as f32;
        assert!(mean < 0.025, "mean relative error {mean}");
    }

    #[test]
    fn every_phase_of_the_pattern_has_a_layout() {
        for rows in 0..6 {
            for cols in 0..6 {
                assert!(Layout::new(&shifted_pattern(rows, cols)).is_some(), "phase {rows},{cols}");
            }
        }
    }

    #[test]
    fn a_pattern_without_lone_greens_has_no_layout() {
        let bayer_like: [u8; 36] = std::array::from_fn(|i| [0u8, 1, 1, 2][(i / 6 % 2) * 2 + i % 6 % 2]);
        assert!(Layout::new(&bayer_like).is_none());
        assert!(Layout::new(&[1; 36]).is_none());
    }

    #[test]
    fn mirror_keeps_every_colour_in_place() {
        for rows in 0..6 {
            for cols in 0..6 {
                let pattern = shifted_pattern(rows, cols);
                let layout = Layout::new(&pattern).unwrap();
                for len in [6usize, 7, 11, 40] {
                    for x in -(REACH as isize)..(len + REACH) as isize {
                        let col = mirror(x, len, layout.mirror_col);
                        let row = mirror(x, len, layout.mirror_row);
                        assert!(col < len && row < len);
                        for other in 0..6usize {
                            let wanted_c = pattern[other * 6 + x.rem_euclid(6) as usize];
                            assert_eq!(pattern[other * 6 + col % 6], wanted_c, "col {x} of {len}");
                            let wanted_r = pattern[x.rem_euclid(6) as usize * 6 + other];
                            assert_eq!(pattern[(row % 6) * 6 + other], wanted_r, "row {x} of {len}");
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn measured_samples_pass_through_untouched() {
        let (w, h) = (60, 48);
        let raw = noise(w, h, 0x1234_5678);
        let rgb = demosaic(&raw, w, h, &Layout::new(&PATTERN).unwrap());
        for row in 0..h {
            for col in 0..w {
                let channel = PATTERN[(row % 6) * 6 + col % 6] as usize;
                assert_eq!(rgb[(row * w + col) * 3 + channel], raw[row * w + col], "at {row},{col}");
            }
        }
    }

    #[test]
    fn a_pixel_depends_only_on_the_mosaic_within_reach() {
        let (w, h) = (300, 276);
        let raw = noise(w, h, 0x9e37_79b9);
        let layout = Layout::new(&PATTERN).unwrap();
        let whole = demosaic(&raw, w, h, &layout);
        let (top, left, ch, cw) = (30usize, 54usize, 120usize, 150usize);
        let crop: Vec<f32> = (0..ch).flat_map(|r| raw[(top + r) * w + left..][..cw].iter().copied()).collect();
        let part = demosaic(&crop, cw, ch, &layout);
        for row in REACH..ch - REACH {
            for col in REACH..cw - REACH {
                let a = &whole[((top + row) * w + left + col) * 3..][..3];
                let b = &part[(row * cw + col) * 3..][..3];
                assert_eq!(a, b, "at {row},{col}");
            }
        }
    }
}
