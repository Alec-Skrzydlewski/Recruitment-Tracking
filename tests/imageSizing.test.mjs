import test from 'node:test';
import assert from 'node:assert/strict';
import { fitDimensions, compressionPlan, QUALITY_LADDER } from '../src/lib/imageSizing.js';

test('fitDimensions scales the long side to 800 and leaves small images', () => {
  assert.deepEqual(fitDimensions(4000, 3000), { width: 800, height: 600 });
  assert.deepEqual(fitDimensions(3000, 4000), { width: 600, height: 800 });
  assert.deepEqual(fitDimensions(400, 300), { width: 400, height: 300 });
  assert.deepEqual(fitDimensions(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fitDimensions(100, 800), { width: 100, height: 800 });
});

test('quality plan steps from 0.85 down to 0.4, then shrinks the long edge', () => {
  const plan = compressionPlan();
  assert.deepEqual(plan[0], { maxEdge: 800, quality: 0.85 });
  assert.deepEqual(
    plan.filter(step => step.maxEdge === 800).map(step => step.quality),
    QUALITY_LADDER,
  );
  assert.equal(QUALITY_LADDER[0], 0.85);
  assert.equal(QUALITY_LADDER[QUALITY_LADDER.length - 1], 0.4);
  assert.equal(plan[plan.length - 1].quality, 0.4);
  assert.ok(plan[plan.length - 1].maxEdge < 800);

  const edges = [];
  plan.forEach(step => {
    if (edges[edges.length - 1] !== step.maxEdge) edges.push(step.maxEdge);
  });
  assert.deepEqual(edges, [800, 600, 450, 338, 254, 200]);
  edges.forEach((edge, index) => {
    if (index > 0) assert.ok(edge < edges[index - 1]);
  });
});
