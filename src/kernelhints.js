const hints = [
  [/^(fillet|chamfer): its edges no longer exist/i, "Undo the change that removed the edges, or remove the failed feature and re-pick edges with JS3D.edges(id) on a body that builds."],
  [/^shell: the faces to remove weren't found/i, "Remove the failed shell, then re-pick faces with JS3D.faces(id) on a body that builds."],
  [/^empty group/i, "Undo the step that emptied the group, or remove the empty group and group existing bodies again."],
  [/taper.*(collapses|edges vanish)/i, "Try a smaller taper or distance."],
  [/corner radius is too large|^radius is too large|^bevel is too large/i, "Try a smaller radius or bevel."],
  [/^(fillet|chamfer).*too large|^(fillet|chamfer):/i, "Use JS3D.undo() or remove the failed feature, then retry with smaller values."],
  [/^shell:/i, "Use JS3D.undo() or remove the failed feature, then retry with a thinner wall."],
  [/boolean.*(fail|empty)|nothing is left|nothing.*(intersection|cut)/i, "Try making the shapes overlap clearly, or move the cutter a little."],
  [/couldn't sweep|path doubles back/i, "Try a smaller profile or a gentler path."],
  [/couldn't read this body's sketch|select a closed profile/i, "Check the sketch and close its profile."],
];
export function kernelHint(message) {
  return hints.find(([pattern]) => pattern.test(message))?.[1] || "";
}
export function withKernelHint(message) {
  const hint = kernelHint(message || "");
  return hint ? `${message} ${hint}` : message;
}
