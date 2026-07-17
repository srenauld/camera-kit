const path = require('node:path');
const { getDefaultConfig } = require('@react-native/metro-config');

const projectRoot = __dirname;
const packageRoot = path.resolve(projectRoot, '..');
const workspaceRoot = path.resolve(projectRoot, '../../..');
const defaults = getDefaultConfig(projectRoot);

module.exports = {
  ...defaults,
  resolver: {
    ...defaults.resolver,
    disableHierarchicalLookup: true,
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(packageRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
  },
  watchFolders: [packageRoot, workspaceRoot],
};
