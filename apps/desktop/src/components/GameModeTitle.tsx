import { colors } from "@ninesixteen/brand";

/** Panel heading for the gamemode sidebar tab — Bungee wordmark, mint/coral split. */
export function GameModeTitle() {
  return (
    <h1 className="panel-title gamemode-title">
      <span style={{ color: colors.blue }}>game</span>
      <span style={{ color: colors.pink }}>mode</span>
    </h1>
  );
}
