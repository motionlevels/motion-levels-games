/**
 * Static player-menu to venue-host adapter protocol.
 *
 * Bump this only for a breaking request, response, or WebSocket change. The
 * games bundle publishes the value so a venue image can fail closed before it
 * serves an incompatible menu.
 */
export const playerMenuAdapterProtocolVersion = 2 as const;
