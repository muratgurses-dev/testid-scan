import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { testidSource } from '../../dist/vite.js';

// TESTID_SOURCE=1: a test build that marks every HTML element with data-tsrc="<file>:<line>"
export default defineConfig({ plugins: [process.env.TESTID_SOURCE ? testidSource({ root: 'src' }) : null, react()].filter(Boolean), base: './', logLevel: 'warn' });
