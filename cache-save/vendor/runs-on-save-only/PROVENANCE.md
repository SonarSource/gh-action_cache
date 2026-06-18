# Vendored: runs-on/cache save-only bundle

- **Source:** <https://github.com/runs-on/cache>
- **Ref (SHA):** 88d90644011a3a9957fd141a106f5a94f9794203 (tag v5.0.7)
- **Path in source:** dist/save-only/
- **Retrieved:** 2026-06-18
- **License:** MIT (see LICENSE in this directory)
- **Why vendored (BUILD-11220):** the S3 cache upload is a runs-on patch of `@actions/cache`;
  stock `@actions/cache` writes to GitHub, not S3. We invoke this exact prebuilt bundle (the same
  bytes GitHub runs for `uses: runs-on/cache@<SHA>`) via `child_process.fork` from our `cache-save`
  post step. Keep this SHA in lockstep with the `runs-on/cache` pin in `action.yml`.
- **Refresh:** run `scripts/refresh-runs-on-save.sh <SHA>` then commit the result.

## SHA256 (verify with: `shasum -a 256 *.js`)

| File | SHA256 |
| --- | --- |
| index.js | df72860fb99537d3ce6fc6bc3e702c7a6414cbe4ea4757e5ad211d69f8ae1479 |
| 136.index.js | debf6b87c85fe54f51c8ed4410fbd2572d01f4e0609c0e251bac6e1260de69a7 |
| 360.index.js | 0d04da07d1d1afb3a7475c2288eaecfa85cddf1f4e23b07f04ed9bfd98ee3050 |
| 443.index.js | 8f65c0b403e0a4589c58644e946f13c20ba1c803405c017f29c5717eea334ce6 |
| 566.index.js | 9b42539c4508561bef2851e9f98c900d746fe13af696396770139ba42bf0714a |
| 579.index.js | 83c70f03db91f24786c95b081ba3d43df4c77ed2a057cc7f270ccb33b2c49972 |
| 605.index.js | 9bc2267266952f5e053fc084791cb0511a6d88f119d6fe2b5de554cc26d00400 |
| 762.index.js | 32dbfe2d80c7f0369b74c939969181d2d8a9f7ce2a3ee4498992c90c79556bed |
| 869.index.js | 37922e1b4eee7c9a367494dc9dca4b963bd03a57b5e6da52a3c046a28a705923 |
| 956.index.js | 860f34b40abfe7cc3b4a47b4681ab255789ce1457a79585f80596ccfe9a6279d |
| 998.index.js | 5cc95a57192f07b86b51e7c77f891c944e551f476c2eea9ac39c7d6ba5c71156 |
