// Metro config for the pnpm monorepo: resolve @hf/shared (workspace symlink) and hoisted deps.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the whole monorepo so changes in packages/shared are picked up.
config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules'), path.resolve(monorepoRoot, 'node_modules')];
// pnpm installs workspace packages and dependencies as symlinks into node_modules/.pnpm.
config.resolver.unstable_enableSymlinks = true;
// @hf/shared declares an "exports" map (".", "./i18n/*").
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
