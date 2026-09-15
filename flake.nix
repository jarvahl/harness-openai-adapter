{
  description = "OpenAI-compatible adapter for Pi";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forEachSystem = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in {
      apps = forEachSystem (pkgs: {
        default = {
          type = "app";
          program = "${pkgs.writeShellScript "harness-openai-adapter" ''
            exec ${pkgs.nodejs_22}/bin/node "$PWD/dist/server.js" "$@"
          ''}";
        };
      });

      devShells = forEachSystem (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.nodejs_22 pkgs.nodePackages.typescript ];
        };
      });
    };
}
