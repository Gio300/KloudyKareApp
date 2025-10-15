# Contracts System

The contracts system provides a portable, phase-aware architecture for deploying functionality across testing, online-test, and live phases.

## Structure

- `/spec/` - Contract specifications defining inputs, outputs, and acceptance criteria
- `/sequences/` - Execution sequences that chain multiple contracts together
- `/containers/` - Docker containers that implement contract functionality
- `/validators/` - Tools to validate contract compliance before phase promotion

## Contract Lifecycle

1. **Define Contract**: Create specification in `/spec/` with clear inputs/outputs
2. **Implement Container**: Build Docker container in `/containers/` that fulfills contract
3. **Create Sequence**: Define execution flow in `/sequences/` 
4. **Test & Validate**: Run in testing phase until contracts pass validation
5. **Promote**: Move successful contracts to next phase

## Phase Promotion

Contracts can be promoted individually or as complete sequences:

```bash
# Promote single contract
./scripts/promote-contract.sh eligibility_intake_v1 testing onlinetest

# Promote entire sequence  
./scripts/promote-sequence.sh sms_eligibility_flow_v1 testing onlinetest
```

## Contract Naming Convention

- Contract ID: `{functionality}_{version}` (e.g., `eligibility_intake_v1`)
- Sequence ID: `{workflow}_{version}` (e.g., `sms_eligibility_flow_v1`)
- Container: `{contract_id}_container`

## Governance

Each contract specifies:
- **Owner**: Which system component governs it (mcp, agent, ai_brain)
- **Dependencies**: Other contracts or services required
- **Validation**: Acceptance criteria for phase promotion
- **Rollback**: Procedure if contract fails in higher phase
