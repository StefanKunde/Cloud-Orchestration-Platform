# Cloud Orchestration Platform

A NestJS backend for automating cloud server lifecycle with cost optimization. Built as a portfolio project to explore distributed systems patterns and cloud automation.

## What it does

Manages Vultr cloud instances programmatically:
- Spins up servers on demand with cloud-init scripts
- Schedules automatic termination at hourly billing boundaries (to save money)
- Uses distributed locking to prevent race conditions when multiple workers run
- Handles the full lifecycle: provision → ready → execute → idle → terminate

## Why I built this

I wanted to learn how to:
- Work with cloud provider APIs (Vultr in this case)
- Implement distributed locking using MongoDB atomic operations
- Optimize costs by scheduling terminations right before the next billing cycle
- Build a state machine for resource lifecycle management

## Tech Stack

- **NestJS** - Backend framework
- **MongoDB** - Database with atomic operations for distributed locks
- **TypeScript** - Strict mode enabled
- **Vultr API** - Cloud infrastructure provider
- **Cloud-init** - OS-level provisioning

## Key Features

**Distributed Locking**

```typescript
// Prevents multiple workers from provisioning the same instance
const lock = await this.acquireLock(instanceId, 900000); // 15 min lease
```

**Cost Optimization**
```typescript
// Terminate 60 seconds before the next hourly billing cycle
const nextBillingCycle = Math.ceil(uptime / 3600) * 3600;
const terminationTime = nextBillingCycle - 60;
```

**State Machine**
- PROVISIONING → Server is being created
- READY → Server is up and available
- EXECUTING → Server is running a task
- IDLE → Server is free
- TERMINATING → Shutdown in progress
- TERMINATED / ERROR → Final states

## Performance

- Lock acquisition: <50ms (MongoDB findAndModify)
- Provision time: 60-120 seconds (Vultr dependent)
- Scan interval: 15-second cycles for scheduling
- Parallel workers: Up to 30 concurrent terminations

## Setup

```bash
npm install
cp .env.example .env
# Add your Vultr API key and MongoDB connection string
npm run start:dev
```

## Learnings

- Distributed locks need careful TTL management to prevent deadlocks
- Cloud provider APIs can be flaky - retry logic with exponential backoff is essential
- Billing optimization requires precise timing (60s buffer is safe)
- MongoDB atomic operations are great for coordination

## Not Production-Ready

This is a portfolio/learning project. For production use you'd need:
- Better error handling and recovery
- Metrics and monitoring
- Multi-cloud support
- Testing across different failure scenarios
- Security hardening

## License

MIT

## Author

Stefan Kunde
