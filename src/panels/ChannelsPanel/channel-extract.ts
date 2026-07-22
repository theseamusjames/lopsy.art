/**
 * Channel identifier used by ChannelsPanel. The extraction itself now
 * happens on the GPU via `readChannelThumbnail` in the WASM bridge —
 * the CPU per-pixel loop that used to live here was removed in the
 * fix for #683.
 */

export type ChannelId = 'r' | 'g' | 'b' | 'a';
