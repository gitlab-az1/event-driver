module.exports = {
  presets: [
    [
      '@babel/preset-env',
      {
        targets: {
          node: '18',
        },
      },
    ],
    '@babel/preset-typescript',
  ],
  plugins: [
    '@babel/plugin-transform-typescript',
    '@babel/plugin-transform-private-methods',
    '@babel/plugin-transform-class-properties',
    ['module-resolver', {
      alias: {
        '@util': './src/util',
      },
    }],
  ],
};
