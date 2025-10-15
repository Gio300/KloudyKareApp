# Database Migrations

This directory contains SQL migration files for the Kloudy Kare database.

## Agent Tables

The `agent_tables.sql` file contains the schema for agent-assisted features:

### Tables

1. **agent_notes** - Stores notes created by the agent
   - AI-enhanced categorization and prioritization
   - Action items extraction
   - Session and user tracking

2. **agent_profiles** - Stores profiles created by the agent
   - Profile completeness tracking
   - AI-suggested improvements
   - Role-based categorization

3. **agent_tasks** - Stores scheduled tasks
   - Priority and category management
   - Estimated time tracking
   - Status workflow (pending → in-progress → completed)

4. **agent_reminders** - Stores scheduled reminders
   - Multi-channel support (email, SMS, etc.)
   - Delivery tracking
   - Status management

## Running Migrations

For PostgreSQL:
```bash
psql -U your_user -d your_database -f agent_tables.sql
```

For SQLite (testing):
```bash
sqlite3 kloudy_testing.db < agent_tables.sql
```

## Notes

- All tables use VARCHAR(255) for IDs to support custom ID generation
- Timestamps use CURRENT_TIMESTAMP for automatic tracking
- Indexes are created for commonly queried fields
- JSON data is stored as TEXT (action_items, additional_info)
