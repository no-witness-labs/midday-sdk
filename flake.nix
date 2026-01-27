{
  description = "Midnight SDK development environment";

  inputs.nixpkgs.url = "https://flakehub.com/f/NixOS/nixpkgs/0.1";

  outputs = inputs:
    let
      supportedSystems = [ "x86_64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forEachSupportedSystem = f: inputs.nixpkgs.lib.genAttrs supportedSystems (system: f {
        pkgs = import inputs.nixpkgs { inherit system; };
        inherit system;
      });
    in
    {
      devShells = forEachSupportedSystem ({ pkgs, system }:
        let
          compactVersion = "v0.27.0-rc.1";

          compactMeta = {
            "x86_64-linux" = {
              arch = "x86_64-unknown-linux-musl";
              hash = "sha256-X+EEBq0RxZT1U1Fp8NmJSqrJwg7uqLrtnWUQoAPXdiQ=";
            };
            "x86_64-darwin" = {
              arch = "x86_64-darwin";
              hash = "sha256-oTHjsJCwiSIvotnrogX6RZvux6ZpkPJ9EIU5XTWvmaA=";
            };
            "aarch64-darwin" = {
              arch = "aarch64-darwin";
              hash = "sha256-srHuUNUqrVRzk/PwgL4DpmfNrR++4z7NEVxGjuC4CJ8=";
            };
          }.${system};

          compact = pkgs.stdenv.mkDerivation {
            pname = "compact";
            version = compactVersion;

            src = pkgs.fetchzip {
              url = "https://github.com/midnightntwrk/compact/raw/main/prerelease/compactc-0.27/compactc_${compactVersion}_${compactMeta.arch}.zip";
              hash = compactMeta.hash;
              stripRoot = false;
            };

            # Skip configure/build phases - these are prebuilt binaries
            dontConfigure = true;
            dontBuild = true;

            installPhase = ''
              mkdir -p $out/bin
              for f in compactc compactc.bin zkir format-compact fixup-compact; do
                [ -f "$f" ] && cp "$f" $out/bin/
              done
              find "$out/bin" -type f -exec chmod +x {} +
            '';

            meta = {
              description = "Midnight Compact compiler";
              platforms = [ system ];
            };
          };
        in
        {
          default = pkgs.mkShell {
            packages = [
              compact
              pkgs.nodejs
              pkgs.nodePackages.pnpm
              pkgs.bun
            ];

            shellHook = ''
              echo "🌙 Midnight SDK dev environment"
              echo "   compact: ${compactVersion}"
              echo "   node: $(node --version)"
            '';
          };
        });
    };
}
