/** Map DB `replicability_rating` to short UI labels. */
export function replicabilityLabel(r: string | null | undefined): string {
  switch (r) {
    case "highly_replicable":
      return "Highly replicable";
    case "strong_pattern":
      return "Strong pattern";
    case "moderate":
      return "Moderate";
    case "weak":
      return "Weak";
    default:
      return r?.replace(/_/g, " ") ?? "";
  }
}
