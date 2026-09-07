# Graph and geometry authoring hypothesis v1

Use this when the learner must read or reason from a plotted function, coordinate diagram, or geometric figure.

1. Fix the equations, coordinates, domain, labels, and intended answer in a numeric spec before rendering.
2. Recalculate intersections, lengths, slopes, or other answer values independently of the authored option key.
3. Show the minimum axes, scale, point names, line styles, and conditions needed to read the figure. Keep monochrome distinctions legible without relying on color alone.
4. Do not print coordinates or annotations that directly reveal the requested value unless reading that annotation is the objective.
5. Keep generated figures in `generated-image`; preserve the generator, version, script, spec, and hashes. Reject external SVG resource references.
6. Inspect mathematical consistency separately from actual rendering, including clipping, overlapping labels, unreadable ticks, and missing assets.

A realistic-looking graph does not make an item an application task. The learner response must still provide the evidence named by the objective.
