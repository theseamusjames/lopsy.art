//! The operations the command line can ask for, parsed from `name` or
//! `name=value,value`. Each is one of the engine's filter or layer
//! commands: nothing here draws.

use lopsy_engine::commands::{filter, layer};
use lopsy_engine::engine::EngineInner;

#[derive(Clone, Debug, PartialEq)]
pub enum Operation {
    GaussianBlur { radius: u32 },
    BoxBlur { radius: u32 },
    UnsharpMask { radius: u32, amount: f32, threshold: u32 },
    Pixelate { block_size: u32 },
    Posterize { levels: u32 },
    Invert,
    Desaturate,
    FlipHorizontal,
    FlipVertical,
}

/// What `--help` lists, in the form `parse` accepts.
pub const USAGE: &[(&str, &str)] = &[
    ("blur=<radius>", "Gaussian blur, radius in pixels"),
    ("box-blur=<radius>", "Box blur, radius in pixels"),
    ("unsharp=<radius>,<amount>,<threshold>", "Unsharp mask; threshold 0 to 255"),
    ("pixelate=<block>", "Mosaic of <block> by <block> pixel squares"),
    ("posterize=<levels>", "Reduce each channel to <levels> levels"),
    ("invert", "Invert the colours"),
    ("desaturate", "Remove the colour"),
    ("flip-h", "Flip left to right"),
    ("flip-v", "Flip top to bottom"),
];

impl Operation {
    pub fn parse(text: &str) -> Result<Self, String> {
        let (name, values) = match text.split_once('=') {
            Some((name, values)) => (name, values.split(',').collect::<Vec<_>>()),
            None => (text, Vec::new()),
        };
        let expect = |count: usize| {
            if values.len() == count {
                Ok(())
            } else {
                Err(format!("`{name}` takes {count} value(s), got {}", values.len()))
            }
        };
        match name {
            "blur" => expect(1).and_then(|()| Ok(Self::GaussianBlur { radius: number(name, values[0])? })),
            "box-blur" => expect(1).and_then(|()| Ok(Self::BoxBlur { radius: number(name, values[0])? })),
            "unsharp" => expect(3).and_then(|()| {
                Ok(Self::UnsharpMask {
                    radius: number(name, values[0])?,
                    amount: number(name, values[1])?,
                    threshold: number(name, values[2])?,
                })
            }),
            "pixelate" => expect(1).and_then(|()| Ok(Self::Pixelate { block_size: number(name, values[0])? })),
            "posterize" => expect(1).and_then(|()| Ok(Self::Posterize { levels: number(name, values[0])? })),
            "invert" => expect(0).map(|()| Self::Invert),
            "desaturate" => expect(0).map(|()| Self::Desaturate),
            "flip-h" => expect(0).map(|()| Self::FlipHorizontal),
            "flip-v" => expect(0).map(|()| Self::FlipVertical),
            _ => Err(format!("unknown operation `{name}`")),
        }
    }

    /// Apply the operation to a layer, through the command a host calls.
    pub fn apply(&self, engine: &mut EngineInner, layer_id: &str) -> Result<(), String> {
        match *self {
            Self::GaussianBlur { radius } => filter::blur::filter_gaussian_blur(engine, layer_id, radius),
            Self::BoxBlur { radius } => filter::blur::filter_box_blur(engine, layer_id, radius),
            Self::UnsharpMask { radius, amount, threshold } => {
                filter::blur::filter_unsharp_mask(engine, layer_id, radius, amount, threshold);
            }
            Self::Pixelate { block_size } => filter::stylize::filter_pixelate(engine, layer_id, block_size),
            Self::Posterize { levels } => filter::adjust::filter_posterize(engine, layer_id, levels),
            Self::Invert => filter::adjust::filter_invert(engine, layer_id),
            Self::Desaturate => filter::adjust::filter_desaturate(engine, layer_id),
            Self::FlipHorizontal => layer::flip_layer(engine, layer_id, true)?,
            Self::FlipVertical => layer::flip_layer(engine, layer_id, false)?,
        }
        Ok(())
    }
}

fn number<T: std::str::FromStr>(name: &str, value: &str) -> Result<T, String> {
    value.trim().parse().map_err(|_| format!("`{name}`: `{value}` is not a number it accepts"))
}

#[cfg(test)]
mod tests {
    use super::Operation;

    #[test]
    fn an_operation_with_one_value() {
        assert_eq!(Operation::parse("blur=8"), Ok(Operation::GaussianBlur { radius: 8 }));
        assert_eq!(Operation::parse("pixelate=12"), Ok(Operation::Pixelate { block_size: 12 }));
    }

    #[test]
    fn an_operation_with_several_values() {
        assert_eq!(
            Operation::parse("unsharp=4,1.5,10"),
            Ok(Operation::UnsharpMask { radius: 4, amount: 1.5, threshold: 10 }),
        );
    }

    #[test]
    fn an_operation_with_no_value() {
        assert_eq!(Operation::parse("invert"), Ok(Operation::Invert));
        assert_eq!(Operation::parse("flip-v"), Ok(Operation::FlipVertical));
    }

    #[test]
    fn the_wrong_number_of_values_is_refused() {
        assert!(Operation::parse("blur").is_err());
        assert!(Operation::parse("blur=1,2").is_err());
        assert!(Operation::parse("invert=1").is_err());
    }

    #[test]
    fn a_value_that_is_not_a_number_is_refused() {
        assert!(Operation::parse("blur=wide").is_err());
        assert!(Operation::parse("blur=-3").is_err());
    }

    #[test]
    fn an_unknown_name_is_refused_by_name() {
        assert_eq!(Operation::parse("sparkle=3"), Err("unknown operation `sparkle`".to_string()));
    }

    #[test]
    fn every_listed_usage_parses_once_its_placeholders_are_filled() {
        for (form, _) in super::USAGE {
            let filled = form.replace("<radius>", "3").replace("<amount>", "1").replace("<threshold>", "0")
                .replace("<block>", "4").replace("<levels>", "4");
            assert!(Operation::parse(&filled).is_ok(), "{form}");
        }
    }
}
