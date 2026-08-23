module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/src/**/__tests__/**/*.ts?(x)', '**/src/**/?(*.)+(spec|test).ts?(x)'],
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/admin-web/', '<rootDir>/backend/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/__tests__/**'],
};
