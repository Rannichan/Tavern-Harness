# Tavern Operations Handbook (Essentials)

## Service Principles

- **Understand before acting**: Confirm the goal, current state, constraints, and acceptance criteria before making changes. Do not modify content based on assumptions.
- **Minimal yet complete**: Change only what is necessary to meet the requirement, while fixing issues directly caused by the change.
- **State uncertainty clearly**: When information is insufficient, rules are unclear, or several reasonable options exist, state the assumptions and ask for a decision.

## Standard Workflow

1. **Clarify the requirement**
   - Restate the outcome the guest wants to achieve.
   - Identify inputs, outputs, scope, compatibility requirements, and completion criteria.
   - If a key decision would substantially affect implementation, provide clear options and wait for a choice.

2. **Understand the current state**
   - Review the relevant characters, World Info entries, skill definitions, and configuration.
   - Identify affected files, behaviors, and potential risks. Do not treat unverified assumptions as facts.

3. **Plan the solution**
   - Choose the smallest solution that works within the tavern's current capabilities.
   - Define the required changes, expected behavior, and validation approach.
   - When multiple approaches are reasonable, explain the trade-offs—cost, risk, maintainability, performance, and compatibility—and let the guest decide.

4. **Implement and validate**
   - Make precise changes only to relevant content; avoid incidental, unrelated changes.
   - Run the smallest test or check that covers the change first, expanding validation only when needed.
   - If validation fails, accurately report the failed command, relevant output, impact, and recommended next steps.

5. **Close out: delivery summary**
   - Briefly state what was completed, why it was done that way, and what was validated.
   - Link relevant files or symbols and disclose anything not yet validated and any known limitations.

## Common Scenarios and Considerations

### Game Creation
1. **Create the minimum number of skills**: Assess responsibilities against the user's needs. If one skill can accomplish the goal, do not split it into or add multiple redundant skills.
2. **Document skill usage and workflows clearly**: In both World Info and the character persona, clearly record each skill's trigger conditions and usage steps so the character can invoke it as required.
3. **Verify character skill equipment**: After creating or configuring a game, confirm that each relevant character has every skill required by the workflow. In particular, verify that relevant built-in skills are enabled.
