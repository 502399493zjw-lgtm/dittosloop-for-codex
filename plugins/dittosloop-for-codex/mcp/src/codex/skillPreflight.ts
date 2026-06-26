import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { resolveEffectiveProfilesByStep } from "../contract/agentProfiles.js";
import type { EffectiveAgentProfile, FormalLoopContract, SkillRequirement } from "../contract/types.js";
import type { SkillPreflightCheck, SkillPreflightReport, SkillPreflightStatus } from "../types.js";

export interface SkillAvailabilityProvider {
  check(requirement: SkillRequirement, profile: EffectiveAgentProfile): Promise<{
    status: SkillPreflightStatus;
    message: string;
    locations?: string[];
  }>;
}

export const defaultSkillAvailabilityProvider: SkillAvailabilityProvider = {
  async check(requirement, profile) {
    const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
    const locations = await findLocationsForRequirement(requirement, profile, codexHome);

    if (locations.length > 0) {
      return {
        status: "passed",
        message: `Found ${requirement.id}`,
        locations
      };
    }

    if (requirement.source === "project" && !profile.workdir) {
      return {
        status: "unknown",
        message: `Project skill ${requirement.id} could not be checked because profile ${profile.id} has no workdir`
      };
    }

    if (requirement.source === "plugin" && !requirement.pluginId) {
      return {
        status: "unknown",
        message: `Plugin skill ${requirement.id} could not be checked because no pluginId was provided`
      };
    }

    return {
      status: requirement.source ? "missing" : "unknown",
      message: requirement.source
        ? `Skill ${requirement.id} was not found in the expected ${requirement.source} location`
        : `Skill ${requirement.id} was not found in known skill locations`
    };
  }
};

export async function runSkillProfilePreflight(
  contract: FormalLoopContract,
  options: {
    provider?: SkillAvailabilityProvider;
    allowDegradedProfiles?: boolean;
  } = {}
): Promise<SkillPreflightReport | undefined> {
  const provider = options.provider ?? defaultSkillAvailabilityProvider;
  const effectiveProfiles = resolveEffectiveProfilesByStep(contract);
  const checks: SkillPreflightCheck[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];

  for (const profile of effectiveProfiles.values()) {
    for (const requirement of profile.requiredSkills) {
      const result = await provider.check(requirement, profile);
      const check = createPreflightCheck(profile, requirement, true, result);
      checks.push(check);
      if (result.status !== "passed") {
        blockers.push(buildCheckSummary(profile, requirement, true, result));
      }
    }

    for (const requirement of profile.advisorySkills) {
      const result = await provider.check(requirement, profile);
      const check = createPreflightCheck(profile, requirement, false, result);
      checks.push(check);
      if (result.status !== "passed") {
        warnings.push(buildCheckSummary(profile, requirement, false, result));
      }
    }
  }

  if (checks.length === 0) {
    return undefined;
  }

  return {
    status: blockers.length > 0 ? (options.allowDegradedProfiles ? "degraded" : "blocked") : warnings.length > 0 ? "warning" : "passed",
    checks,
    warnings,
    blockers,
    allowDegradedProfiles: options.allowDegradedProfiles || undefined
  };
}

function createPreflightCheck(
  profile: EffectiveAgentProfile,
  requirement: SkillRequirement,
  required: boolean,
  result: Awaited<ReturnType<SkillAvailabilityProvider["check"]>>
): SkillPreflightCheck {
  return {
    profileId: profile.id,
    profileLabel: profile.label,
    stepId: profile.stepId,
    skill: requirement,
    required,
    status: result.status,
    message: result.message,
    locations: result.locations
  };
}

function buildCheckSummary(
  profile: EffectiveAgentProfile,
  requirement: SkillRequirement,
  required: boolean,
  result: Awaited<ReturnType<SkillAvailabilityProvider["check"]>>
): string {
  const prefix = `Profile ${profile.label} (step ${profile.stepId}) ${required ? "requires" : "advises"} skill ${requirement.id}`;
  if (result.status === "passed") {
    return `${prefix}: ${result.message}`;
  }

  if (result.status === "missing") {
    return `${prefix}, but it is missing. ${result.message}`;
  }

  return `${prefix}, but availability is unknown. ${result.message}`;
}

async function findLocationsForRequirement(
  requirement: SkillRequirement,
  profile: EffectiveAgentProfile,
  codexHome: string
): Promise<string[]> {
  switch (requirement.source) {
    case "plugin":
      return requirement.pluginId ? findPluginSkillLocations(codexHome, requirement.pluginId, requirement.id) : [];
    case "project":
      return profile.workdir ? findSkillAtRoot(join(profile.workdir, ".codex", "skills"), requirement.id) : [];
    case "user":
      return findSkillAtRoot(join(codexHome, "skills"), requirement.id);
    case "system":
      return findSkillAtRoot(join(codexHome, "skills", ".system"), requirement.id);
    default:
      return findKnownSkillLocations(requirement, profile, codexHome);
  }
}

async function findKnownSkillLocations(
  requirement: SkillRequirement,
  profile: EffectiveAgentProfile,
  codexHome: string
): Promise<string[]> {
  const locations = new Set<string>();

  if (profile.workdir) {
    for (const location of await findSkillAtRoot(join(profile.workdir, ".codex", "skills"), requirement.id)) {
      locations.add(location);
    }
  }

  for (const location of await findSkillAtRoot(join(codexHome, "skills"), requirement.id)) {
    locations.add(location);
  }

  for (const location of await findSkillAtRoot(join(codexHome, "skills", ".system"), requirement.id)) {
    locations.add(location);
  }

  if (requirement.pluginId) {
    for (const location of await findPluginSkillLocations(codexHome, requirement.pluginId, requirement.id)) {
      locations.add(location);
    }
  }

  return [...locations];
}

async function findSkillAtRoot(root: string, skillId: string): Promise<string[]> {
  const skillPath = join(root, skillId, "SKILL.md");
  return (await pathExists(skillPath)) ? [skillPath] : [];
}

async function findPluginSkillLocations(codexHome: string, pluginId: string, skillId: string): Promise<string[]> {
  const pluginRoot = join(codexHome, "plugins", "cache", pluginId);
  if (!(await pathExists(pluginRoot))) {
    return [];
  }

  const matches: string[] = [];
  const queue = [pluginRoot];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const entries = await readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const entryPath = join(current, entry.name);
      const candidate = join(entryPath, "skills", skillId, "SKILL.md");
      if (await pathExists(candidate)) {
        matches.push(candidate);
      }
      queue.push(entryPath);
    }
  }

  return matches;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
