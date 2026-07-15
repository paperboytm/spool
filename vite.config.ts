import { defineConfig } from "vite-plus";

const ignoredPaths = ["node_modules/**", "packages/git/**", "target/**"];

export default defineConfig({
  run: {
    tasks: {
      "rust-build": {
        command: "cargo build --workspace --all-targets",
        cache: false,
      },
      "rust-fmt": {
        command: "cargo fmt --all",
        cache: false,
      },
      "rust-fmt-check": {
        command: "cargo fmt --all -- --check",
        cache: false,
      },
      "rust-lint": {
        command: "cargo clippy --workspace --all-targets --all-features -- -D warnings",
        cache: false,
      },
      "rust-test": {
        command: "cargo test --workspace --all-features",
        cache: false,
      },
    },
  },
  staged: {
    "*.{js,json,jsonc,md,mjs,ts,yaml,yml,toml}": "vp check --fix --no-error-on-unmatched-pattern",
  },
  lint: {
    ignorePatterns: ignoredPaths,
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: [...ignoredPaths, "Cargo.lock"],
    proseWrap: "preserve",
    sortImports: {},
    sortPackageJson: true,
  },
});
