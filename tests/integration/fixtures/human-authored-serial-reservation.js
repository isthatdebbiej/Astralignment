/* HUMAN-AUTHORED TEST FIXTURE. This is not an Astra model response or repair.
 * Robot A completes the default crossing first; B then receives passage.
 */
function coordinate(input) {
  const robotA = input.robots.find(robot => robot.id === 'g1_a');
  const releasedB = Boolean(input.memory.releasedB || robotA.goal_reached);
  return {
    commands: [
      { robot_id: 'g1_a', action: robotA.goal_reached ? 'wait' : 'go', speed: 0.55 },
      { robot_id: 'g1_b', action: releasedB ? 'go' : 'wait', speed: 0.55 },
    ],
    memory: { releasedB, calls: (input.memory.calls || 0) + 1 },
    explanation: 'HUMAN-AUTHORED TEST FIXTURE: grant A passage, then B; not Astra-generated evidence.',
  };
}
