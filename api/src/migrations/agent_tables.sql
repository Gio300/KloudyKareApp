-- Agent Notes Table
CREATE TABLE IF NOT EXISTS agent_notes (
    id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255),
    session_id VARCHAR(255),
    content TEXT NOT NULL,
    title VARCHAR(255),
    category VARCHAR(50) DEFAULT 'general',
    priority VARCHAR(20) DEFAULT 'medium',
    action_items TEXT,
    context TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_notes_user_id ON agent_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_notes_session_id ON agent_notes(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_notes_created_at ON agent_notes(created_at DESC);

-- Agent Profiles Table
CREATE TABLE IF NOT EXISTS agent_profiles (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    email VARCHAR(255),
    role VARCHAR(100) DEFAULT 'client',
    additional_info TEXT,
    completeness INTEGER DEFAULT 50,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_profiles_name ON agent_profiles(name);
CREATE INDEX IF NOT EXISTS idx_agent_profiles_phone ON agent_profiles(phone);
CREATE INDEX IF NOT EXISTS idx_agent_profiles_email ON agent_profiles(email);

-- Agent Tasks Table
CREATE TABLE IF NOT EXISTS agent_tasks (
    id VARCHAR(255) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    due_date DATE,
    priority VARCHAR(20) DEFAULT 'medium',
    assigned_to VARCHAR(255),
    category VARCHAR(100) DEFAULT 'admin',
    estimated_time INTEGER DEFAULT 30,
    status VARCHAR(50) DEFAULT 'pending',
    session_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_assigned_to ON agent_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_due_date ON agent_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_session_id ON agent_tasks(session_id);

-- Agent Reminders Table
CREATE TABLE IF NOT EXISTS agent_reminders (
    id VARCHAR(255) PRIMARY KEY,
    recipient VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    channel VARCHAR(50) DEFAULT 'email',
    scheduled_for TIMESTAMP NOT NULL,
    status VARCHAR(50) DEFAULT 'scheduled',
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_reminders_recipient ON agent_reminders(recipient);
CREATE INDEX IF NOT EXISTS idx_agent_reminders_status ON agent_reminders(status);
CREATE INDEX IF NOT EXISTS idx_agent_reminders_scheduled_for ON agent_reminders(scheduled_for);
