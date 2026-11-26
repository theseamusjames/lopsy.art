# rawtoaces-data (vendored subset)

Measured spectral data from the Academy Software Foundation's
`rawtoaces-data` repository, used as input to the generator of the Sony
colour table (`engine/core/tests/sony_colour_table.rs`, which writes
`engine/core/src/arw/colour_table.rs`). Nothing here is read by the engine
at run time or built into the wasm bundle.

- Repository: https://github.com/AcademySoftwareFoundation/rawtoaces-data
- Commit: `e9b8503cf8a0641f40e5345d9757bde60c15f423` (2026-07-30, "Update
  CHANGES for the v1.1.0 release"), from a shallow clone.
- Files, copied byte for byte (nothing was altered), at the same paths:
  - `LICENSE` (Apache License 2.0, the repository's licence)
  - `data/camera/Sony_DSC-RX100M4_380_780_5.json`
  - `data/camera/Sony_ILCE-6400_380_780_5.json`
  - `data/camera/Sony_ILCE-7CM2_380_780_5.json`
  - `data/camera/Sony_ILCE-7M3_380_780_5.json`
  - `data/camera/Sony_ILCE-7M4_380_780_5.json`
  - `data/camera/Sony_ILCE-7RM2_380_780_5.json`
  - `data/camera/Sony_ILCE-7RM3_380_780_5.json`
  - `data/camera/Sony_ILCE-7RM4_380_780_5.json`
  - `data/camera/Sony_ILCE-7SM2_380_780_5.json`
  - `data/camera/Sony_ILCE-7SM3_380_780_5.json`
  - `data/camera/Sony_ILCE-9_380_780_5.json`
  - `data/cmf/cmf_1931.json`
  - `data/training/training_spectral.json`

## Licences

The camera sensitivity files and the training spectra each declare
`"license": "Apache-2.0"` in their own header (the camera files were
measured by Weta Digital; the training set is from "scitech").

`data/cmf/cmf_1931.json`, the CIE 1931 standard observer, declares
`"license": "CC-BY-4.0"` in its header, not Apache-2.0. Its source, as the
file states: CIE 2019, *Colour-matching functions of CIE 1931 standard
colorimetric observer*, International Commission on Illumination (CIE),
Vienna, AT, DOI 10.25039/CIE.DS.xvudnb9b. Used under CC BY 4.0 with that
attribution.
