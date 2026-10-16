/**
 * The package summary's `coreTargets`: the AI clients Core publishes, or why it
 * does not. The preview and both regression checks build it through this, from
 * the answer of the service's `coreTargets` operation.
 */
export function coreTargetsSummary(answer) {
  return answer.ok
    ? { state: "published", source: "@aihq/core/harness nativeClientIds", targets: answer.targets, labels: answer.labels }
    : { state: "unavailable", reason: answer.error };
}
