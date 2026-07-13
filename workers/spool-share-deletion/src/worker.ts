// Thin deploy shell: the sweep logic lives next to the backend code it
// cleans up after, so schema/KV/R2 shape changes review in one place.
// This Worker exists only because Pages Functions can't register crons.
export { default } from '../../../packages/share-backend/functions/_scheduled/deletion-worker'
