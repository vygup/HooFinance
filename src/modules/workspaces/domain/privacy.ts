/** A shared family never grants access to another member's personal side. */
export function belongsToScope(rowWorkspaceId: string, workspaceId: string) {
  return rowWorkspaceId === workspaceId;
}
