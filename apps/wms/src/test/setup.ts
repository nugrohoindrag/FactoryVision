import '@testing-library/jest-dom/vitest';
// jsdom has no IndexedDB; Dexie needs a real one to test the event log.
import 'fake-indexeddb/auto';
