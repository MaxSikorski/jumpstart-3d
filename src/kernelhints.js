const hints = [
  [/corner radius is too large|radius is too large|bevel is too large|^(fillet|chamfer):|^(fillet|chamfer) .*too large/i, "Try a smaller radius, or fewer edges (see JS3D.edges(id))."],
  [/^shell:/i, "Try a thinner wall, or open a different face."],
  [/empty group|boolean.*(fail|empty)|nothing is left|nothing.*(intersection|cut)/i, "Try making the shapes overlap clearly, or move the cutter a little."],
  [/couldn't sweep|taper.*sweep|path doubles back/i, "Try a smaller profile or a gentler path."],
  [/couldn't read this body's sketch|select a closed profile/i, "Check the sketch and close its profile."],
];
export function kernelHint(message) {
  return hints.find(([pattern]) => pattern.test(message))?.[1] || "";
}
export function withKernelHint(message) {
  const hint = kernelHint(message || "");
  return hint ? `${message} ${hint}` : message;
}
