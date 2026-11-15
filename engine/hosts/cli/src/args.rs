//! The command line: `lopsy [--op <operation>]... --out <directory> <image.png>...`

use std::path::PathBuf;

use crate::operation::Operation;

#[derive(Debug, PartialEq)]
pub enum Request {
    Help,
    Run(Job),
}

#[derive(Debug, PartialEq)]
pub struct Job {
    pub operations: Vec<Operation>,
    pub out_dir: PathBuf,
    pub inputs: Vec<PathBuf>,
}

pub fn parse(args: impl IntoIterator<Item = String>) -> Result<Request, String> {
    let mut operations = Vec::new();
    let mut out_dir = None;
    let mut inputs = Vec::new();
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "-h" | "--help" => return Ok(Request::Help),
            "--op" => {
                let text = args.next().ok_or("`--op` needs an operation after it")?;
                operations.push(Operation::parse(&text)?);
            }
            "--out" => {
                let dir = args.next().ok_or("`--out` needs a directory after it")?;
                out_dir = Some(PathBuf::from(dir));
            }
            flag if flag.starts_with("--") => return Err(format!("unknown option `{flag}`")),
            input => inputs.push(PathBuf::from(input)),
        }
    }
    let out_dir = out_dir.ok_or("say where to write the results with `--out <directory>`")?;
    if inputs.is_empty() {
        return Err("no input images".to_string());
    }
    Ok(Request::Run(Job { operations, out_dir, inputs }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_words(words: &str) -> Result<Request, String> {
        parse(words.split_whitespace().map(str::to_string))
    }

    #[test]
    fn operations_keep_the_order_they_were_given_in() {
        let request = parse_words("--op blur=2 --op invert --out done a.png b.png").unwrap();
        assert_eq!(
            request,
            Request::Run(Job {
                operations: vec![Operation::GaussianBlur { radius: 2 }, Operation::Invert],
                out_dir: PathBuf::from("done"),
                inputs: vec![PathBuf::from("a.png"), PathBuf::from("b.png")],
            }),
        );
    }

    #[test]
    fn help_wins_over_everything_else() {
        assert_eq!(parse_words("--op blur=2 --help"), Ok(Request::Help));
    }

    #[test]
    fn an_output_directory_and_an_input_are_required() {
        assert!(parse_words("a.png").is_err());
        assert!(parse_words("--out done").is_err());
    }

    #[test]
    fn a_bad_operation_or_option_is_reported() {
        assert!(parse_words("--op sparkle --out done a.png").unwrap_err().contains("sparkle"));
        assert!(parse_words("--fast --out done a.png").unwrap_err().contains("--fast"));
        assert!(parse_words("--op").is_err());
    }
}
