//! Black levels as RAW files record them: one value per position in a
//! repeating tile (per colour site of the CFA, and per sample for files
//! with several samples a pixel), plus, in DNG, a delta per column and per
//! row. Decoders subtract the level of each sample's own position.

/// The largest tile side accepted, in positions. Black levels repeat with
/// the CFA, whose largest pattern in real files is X-Trans' 6×6 (DNG's
/// `BlackLevelRepeatDim` is 1×1, 2×2 or the CFA's repeat in practice);
/// 64 leaves room for any pattern a sensor might use and keeps a crafted
/// size from asking for billions of values.
pub const MAX_TILE: usize = 64;

/// Black levels over a `rows`×`cols` tile that repeats from the raw
/// image's top-left corner, `samples` values per position.
#[derive(Debug, Clone, PartialEq)]
pub struct BlackLevels {
    rows: usize,
    cols: usize,
    samples: usize,
    /// Row-major over the tile, then by sample.
    values: Vec<f64>,
    /// DNG `BlackLevelDeltaH`: added for each column of the raw image.
    delta_h: Vec<f64>,
    /// DNG `BlackLevelDeltaV`: added for each row of the raw image.
    delta_v: Vec<f64>,
}

impl BlackLevels {
    /// One level for every sample.
    pub fn uniform(value: f64) -> Self {
        Self { rows: 1, cols: 1, samples: 1, values: vec![value], delta_h: Vec::new(), delta_v: Vec::new() }
    }

    /// A tile of `rows`×`cols` positions with `samples` values each. None
    /// when the number of values does not fill the tile exactly, or the
    /// tile is more than `MAX_TILE` positions either way.
    pub fn tile(rows: usize, cols: usize, samples: usize, values: Vec<f64>) -> Option<Self> {
        if rows == 0 || cols == 0 || samples == 0 || rows > MAX_TILE || cols > MAX_TILE {
            return None;
        }
        // The sizes come from the file, so the product is checked: on
        // 32-bit wasm a crafted size wraps to the number of values given,
        // and `at` then indexes past the end.
        if rows.checked_mul(cols).and_then(|n| n.checked_mul(samples)) != Some(values.len()) {
            return None;
        }
        Some(Self { rows, cols, samples, values, delta_h: Vec::new(), delta_v: Vec::new() })
    }

    /// Fujifilm's tag 0xF00A in a RAF's CFA sub-IFD. 36 values are a 6×6
    /// tile (X-Trans), 4 a 2×2 tile (Bayer) and 1 a single level. Any other
    /// count is not a tile this decoder knows, and its mean is used for
    /// every site, as it was before levels were kept per site.
    pub fn from_raf(values: &[u32]) -> Option<Self> {
        let v: Vec<f64> = values.iter().map(|&x| x as f64).collect();
        match v.len() {
            0 => None,
            1 => Some(Self::uniform(v[0])),
            4 => Self::tile(2, 2, 1, v),
            36 => Self::tile(6, 6, 1, v),
            n => Some(Self::uniform(v.iter().sum::<f64>() / n as f64)),
        }
    }

    /// A DNG's `BlackLevel` with its `BlackLevelRepeatDim` (rows, columns;
    /// 1×1 when absent) for an image of `samples` samples a pixel. A
    /// count that does not fill the tile falls back to the first value
    /// for every sample, as the decoder did before.
    pub fn from_dng(repeat_dim: Option<(u32, u32)>, values: &[f64], samples: usize) -> Self {
        let (rows, cols) = repeat_dim.map(|(r, c)| (r as usize, c as usize)).unwrap_or((1, 1));
        if values.len() == 1 {
            return Self::uniform(values[0]);
        }
        Self::tile(rows, cols, samples.max(1), values.to_vec())
            .unwrap_or_else(|| Self::uniform(values.first().copied().unwrap_or(0.0)))
    }

    /// Add DNG's per-column (`BlackLevelDeltaH`) and per-row
    /// (`BlackLevelDeltaV`) deltas. Either may be empty.
    pub fn with_deltas(mut self, delta_h: Vec<f64>, delta_v: Vec<f64>) -> Self {
        self.delta_h = delta_h;
        self.delta_v = delta_v;
        self
    }

    /// The level of sample `sample` at (`row`, `col`) of the raw image.
    pub fn at(&self, row: usize, col: usize, sample: usize) -> f64 {
        let i = ((row % self.rows) * self.cols + col % self.cols) * self.samples + sample % self.samples;
        self.values[i] + self.delta_h.get(col).copied().unwrap_or(0.0) + self.delta_v.get(row).copied().unwrap_or(0.0)
    }

    /// The tile's mean level, without the deltas.
    pub fn mean(&self) -> f64 {
        self.values.iter().sum::<f64>() / self.values.len() as f64
    }

    /// True when every sample has the same level: no tile variation and no
    /// deltas.
    pub fn is_uniform(&self) -> bool {
        self.values.iter().all(|&v| v == self.values[0])
            && self.delta_h.iter().all(|&d| d == 0.0)
            && self.delta_v.iter().all(|&d| d == 0.0)
    }

    /// The tile's size in rows and columns.
    pub fn period(&self) -> (usize, usize) {
        (self.rows, self.cols)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raf_counts_map_to_tiles() {
        let six: Vec<u32> = (0..36).map(|i| 1000 + i).collect();
        let b = BlackLevels::from_raf(&six).unwrap();
        assert_eq!(b.period(), (6, 6));
        assert_eq!(b.at(0, 0, 0), 1000.0);
        assert_eq!(b.at(1, 2, 0), 1008.0);
        assert_eq!(b.at(7, 8, 0), 1008.0, "the tile repeats");
        let four = BlackLevels::from_raf(&[1, 2, 3, 4]).unwrap();
        assert_eq!([four.at(0, 0, 0), four.at(0, 1, 0), four.at(1, 0, 0), four.at(3, 3, 0)], [1.0, 2.0, 3.0, 4.0]);
        assert_eq!(BlackLevels::from_raf(&[1020]).unwrap(), BlackLevels::uniform(1020.0));
        assert_eq!(BlackLevels::from_raf(&[1, 2, 3]).unwrap(), BlackLevels::uniform(2.0));
        assert!(BlackLevels::from_raf(&[]).is_none());
    }

    /// A crafted DNG's `BlackLevelRepeatDim` of 2 × 2147483649 with two
    /// values: on 32-bit wasm 2 × 2147483649 wraps to 2, and the tile was
    /// accepted. It is rejected, and so are a product that overflows a
    /// 64-bit usize and a tile past the cap, so the file's first value is
    /// used for every sample.
    #[test]
    fn oversized_tiles_are_rejected() {
        assert!(BlackLevels::tile(2, 2_147_483_649, 1, vec![1.0, 2.0]).is_none());
        assert!(BlackLevels::tile(2, usize::MAX / 2 + 2, 1, vec![1.0, 2.0]).is_none());
        assert!(BlackLevels::tile(MAX_TILE + 1, 1, 1, vec![0.0; MAX_TILE + 1]).is_none());
        assert!(BlackLevels::tile(MAX_TILE, 1, 1, vec![0.0; MAX_TILE]).is_some());
        let b = BlackLevels::from_dng(Some((2, 2_147_483_649)), &[1.0, 2.0], 1);
        assert_eq!(b, BlackLevels::uniform(1.0));
        assert_eq!(b.at(1, 2_147_483_648, 0), 1.0);
    }

    /// What the sample RAFs record: 36 equal values, which are uniform
    /// and have the mean the decoder used to subtract.
    #[test]
    fn equal_raf_levels_are_uniform_with_the_old_mean() {
        let b = BlackLevels::from_raf(&[1020; 36]).unwrap();
        assert!(b.is_uniform());
        assert_eq!(b.mean(), 1020.0);
        assert!(!BlackLevels::from_raf(&[1020, 1021, 1020, 1020]).unwrap().is_uniform());
    }

    #[test]
    fn dng_levels_use_every_value() {
        // A 2×2 repeat, one sample: one level per CFA site.
        let b = BlackLevels::from_dng(Some((2, 2)), &[10.0, 11.0, 12.0, 13.0], 1);
        assert_eq!([b.at(0, 0, 0), b.at(0, 1, 0), b.at(1, 0, 0), b.at(1, 1, 0)], [10.0, 11.0, 12.0, 13.0]);
        assert_eq!(b.at(2, 3, 0), 11.0);
        // No repeat, three samples: one level per sample.
        let b = BlackLevels::from_dng(None, &[1.0, 2.0, 3.0], 3);
        assert_eq!([b.at(5, 5, 0), b.at(5, 5, 1), b.at(5, 5, 2)], [1.0, 2.0, 3.0]);
        // A single value applies everywhere.
        assert!(BlackLevels::from_dng(Some((2, 2)), &[64.0], 1).is_uniform());
        // A count that does not fit the tile: the first value, as before.
        assert_eq!(BlackLevels::from_dng(Some((2, 2)), &[5.0, 6.0], 1), BlackLevels::uniform(5.0));
    }

    #[test]
    fn deltas_add_per_column_and_row() {
        let b = BlackLevels::uniform(100.0).with_deltas(vec![0.5, -0.5], vec![2.0]);
        assert_eq!(b.at(0, 0, 0), 102.5);
        assert_eq!(b.at(0, 1, 0), 101.5);
        assert_eq!(b.at(1, 1, 0), 99.5);
        assert_eq!(b.at(1, 5, 0), 100.0, "columns past the delta table get none");
        assert!(!b.is_uniform());
    }
}
