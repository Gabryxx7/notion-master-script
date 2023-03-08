
const ScriptStatus = {
    NONE: { "name": "None", "id": -1 },
    SCRIPT_NOT_FOUND: { "name": "Script Not Found", "id": 0 },
    STARTED: { "name": "Started", "id": 1 },
    STOPPED: { "name": "Stopped", "id": 2 },
    DISABLED: { "name": "Disabled", "id": 3 },
    RUNNING: { "name": "Running", "id": 4 },
    ERROR: { "name": "Error", "id": 5 }
  }

  const ScriptEnabledStatus = {
    DISABLED: { "name": "Disabled", "id": 0, "value": false },
    ENABLED: { "name": "Enabled", "id": 1, "value": true },
    TEST: { "name": "TEST", "id": -1, "value": false },
  }

module.exports = { ScriptStatus, ScriptEnabledStatus };