#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  parseRepositoryMetadata,
  reconcilePublicDescription,
} from "./githubPrimaryDescription.mts";

const slug = "FixtureOwner/field-notes";
const raw = (overrides: Record<string, unknown> = {}) => ({
  id: 101,
  full_name: slug,
  default_branch: "main",
  description: "Old public description.",
  ...overrides,
});
let checks = 0;
async function check(name: string, work: () => void | Promise<void>) {
  await work();
  checks++;
  console.log(`✔ ${name}`);
}

await check("repository metadata is bounded and tied to the requested slug", () => {
  assert.deepEqual(parseRepositoryMetadata(raw(), slug), {
    id: 101,
    fullName: slug,
    defaultBranch: "main",
    description: "Old public description.",
  });
  for (const value of [null, {}, raw({ id: 0 }), raw({ full_name: "Other/repo" }), raw({ default_branch: "" }), raw({ description: 42 })]) {
    assert.throws(() => parseRepositoryMetadata(value, slug), /không hợp lệ/);
  }
});

await check("reconciliation performs read, description-only patch, and independent readback", async () => {
  const before = parseRepositoryMetadata(raw(), slug);
  const events: string[] = [];
  let current = raw();
  const next = "A compact notebook about clouds and changing light.";
  await reconcilePublicDescription({
    slug,
    before,
    description: next,
    read: async () => { events.push("read"); return structuredClone(current); },
    patch: async (description) => {
      events.push(`patch:${description}`);
      current = raw({ description });
      return structuredClone(current);
    },
  });
  assert.deepEqual(events, ["read", `patch:${next}`, "read"]);
  assert.equal(current.description, next);
});

await check("a changed identity, branch, or About aborts before PATCH", async () => {
  const before = parseRepositoryMetadata(raw(), slug);
  for (const changed of [raw({ id: 202 }), raw({ full_name: "Other/repo" }), raw({ default_branch: "trunk" }), raw({ description: "A concurrent edit." })]) {
    let patches = 0;
    await assert.rejects(
      reconcilePublicDescription({
        slug,
        before,
        description: "A new description.",
        read: async () => changed,
        patch: async () => { patches++; return raw(); },
      }),
      /đổi trong lúc|không hợp lệ/,
    );
    assert.equal(patches, 0);
  }
});

await check("invalid new About copy is rejected before any transport call", async () => {
  const before = parseRepositoryMetadata(raw(), slug);
  for (const description of ["", " padded", "line one\nline two", "x".repeat(351)]) {
    let reads = 0;
    await assert.rejects(
      reconcilePublicDescription({
        slug,
        before,
        description,
        read: async () => { reads++; return raw(); },
        patch: async () => raw(),
      }),
      /About mới/,
    );
    assert.equal(reads, 0);
  }
});

await check("PATCH and readback mismatches are both reported", async () => {
  const before = parseRepositoryMetadata(raw(), slug);
  const next = "A new public description.";
  await assert.rejects(
    reconcilePublicDescription({
      slug,
      before,
      description: next,
      read: async () => raw(),
      patch: async () => raw(),
    }),
    /phản hồi không khớp/,
  );

  let reads = 0;
  await assert.rejects(
    reconcilePublicDescription({
      slug,
      before,
      description: next,
      read: async () => (++reads === 1 ? raw() : raw({ description: "A later overwrite." })),
      patch: async () => raw({ description: next }),
    }),
    /đọc lại không khớp/,
  );
});

console.log(`\n✔ ${checks} GitHub primary About reconciliation checks passed without network access.`);
