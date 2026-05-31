import { a } from './a';

const lazyModule = require('./b');

const loadModule = () => require('./c');

if (process.env.NODE_ENV === 'development') {
  require('./a');
}

const config = process.env.DEBUG ? require('./b') : require('./c');

import('./c').then(module => console.log(module));

const routeName = 'home';
import(`./${routeName}`);

export const utilsPath = require.resolve('./a');

export { b } from './b';
