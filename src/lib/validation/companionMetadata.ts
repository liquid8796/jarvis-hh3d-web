/** Remove only the trailing marker emitted by the former companion-create path.
 * One separating space belongs to that marker; all human wording stays intact.
 */
export function stripCompanionMarker(description: string): string {
  return description.replace(/ ?\[companion:[1-9]\d{12}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\]$/, "");
}
