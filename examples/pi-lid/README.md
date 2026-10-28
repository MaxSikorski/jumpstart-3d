# The Pi lid

`raspberry-pi-4-case-lid.stl` is a 93 x 63 x 10.5 mm lid for a Raspberry Pi 4 case. It fits the CanaKit Raspberry Pi 4 case (the lid is not made by CanaKit).

It is Max Sikorski's own remix of a community model, changed for his use. The original author and link are unknown (the link was lost). If you made the original, please open an issue and we will credit you or remove the file.

## Why it is in the repository

It is the reference model for the app's real-task test: "cover the lid's vents and openings so it prints as a solid plate". Import it, use **Fill openings** or **Box on face**, then export. After the 38 x 38 mm window is cut, the result should be about 13,930 mm3. The tests in `test/` (`fillopenings.spec.mjs`, `facebox.spec.mjs`, `fillopen.test.mjs`, `meshimportfix.test.mjs`) load this file and check that.

## License

The model file is not covered by the app's AGPL license. It is shared as a test reference, and its rights stay with its original author and with Max's remix.
