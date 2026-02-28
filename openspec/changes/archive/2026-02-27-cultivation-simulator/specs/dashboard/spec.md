## ADDED Requirements

### Requirement: Dashboard layout
The UI SHALL use a grid layout with: a top control bar, and four quadrants — top-left (level distribution bar chart), top-right (population trend line chart), bottom-left (event log), bottom-right (statistics panel).

#### Scenario: All panels visible
- **WHEN** the application loads
- **THEN** all four quadrants and the control bar SHALL be visible without scrolling on a 1920x1080 viewport

### Requirement: Control bar
The control bar SHALL display: simulation title, current year, seed value, start/pause button, single-step button, speed selector, reset button, and initial population input (editable only when simulation is paused/not started).

#### Scenario: Start and pause
- **WHEN** user clicks start
- **THEN** simulation begins; button changes to pause

#### Scenario: Single step
- **WHEN** user clicks step while paused
- **THEN** exactly one year SHALL be simulated

#### Scenario: Reset
- **WHEN** user clicks reset
- **THEN** simulation returns to Year 0 with empty state

### Requirement: Speed modes
The system SHALL provide three speed tiers controlling how many years the Worker computes per UI update cycle (~2 second intervals):
- Tier 1: 100 years per 2 seconds (50 ticks/sec)
- Tier 2: 500 years per 2 seconds (250 ticks/sec)
- Tier 3: 1000 years per 2 seconds (500 ticks/sec)

The Worker SHALL batch-compute the configured number of years, then post an aggregated summary to the main thread. UI SHALL update approximately every 2 seconds.

#### Scenario: Tier 1 speed
- **WHEN** user selects Tier 1 speed
- **THEN** the Worker SHALL compute ~100 years and post a summary every ~2 seconds

#### Scenario: Speed change during run
- **WHEN** user changes speed while simulation is running
- **THEN** the new speed SHALL take effect on the next batch cycle

### Requirement: Level distribution chart
The top-left panel SHALL display a bar chart (Recharts BarChart) showing cultivator counts for Lv1–Lv7. An optional toggle SHALL switch between linear and logarithmic Y-axis scale.

#### Scenario: Bar chart data
- **WHEN** a year summary arrives
- **THEN** the bar chart SHALL update to show the latest level counts

#### Scenario: Log scale toggle
- **WHEN** user toggles to logarithmic scale
- **THEN** the Y-axis SHALL use log10 scale

### Requirement: Population trend chart
The top-right panel SHALL display a line chart (Recharts LineChart) with 7 lines (one per level Lv1–Lv7). X-axis = simulation year, Y-axis = cultivator count. Trend data SHALL retain a maximum of 10,000 data points; older data SHALL be downsampled.

#### Scenario: Trend data accumulation
- **WHEN** simulation runs for 500 years at Tier 1 speed
- **THEN** trend chart SHALL show 500 data points (one per year)

#### Scenario: Trend data downsampling
- **WHEN** trend data exceeds 10,000 points
- **THEN** the oldest data SHALL be downsampled to maintain the cap

### Requirement: Event log
The bottom-left panel SHALL display a scrollable event list with newest events at top. Events include: combat (with winner/loser levels and cultivation), promotion (level change), and expiry (age-out death). The log SHALL support filtering by level. The main thread SHALL retain a maximum of 1000 events; when exceeded, the oldest events SHALL be discarded.

The Worker SHALL emit at most 50 events per tick to the main thread. High-level events (Lv3+ combat/promotion) SHALL always be included when they occur.

#### Scenario: Event log filtering
- **WHEN** user selects Lv3 filter
- **THEN** only events involving Lv3 cultivators SHALL be displayed

#### Scenario: Event log capacity
- **WHEN** total events exceed 1000
- **THEN** the oldest events SHALL be discarded to maintain 1000 event cap

### Requirement: Statistics panel
The bottom-right panel SHALL display: total population, new cultivators this year, deaths this year (combat + expiry breakdown), promotions this year, and highest-level cultivator info (level, cultivation, age).

#### Scenario: Stats update
- **WHEN** a year summary arrives from Worker
- **THEN** all statistics SHALL reflect the latest year's data

### Requirement: Worker-UI communication
The Worker SHALL communicate via postMessage. Message types from main to Worker: start (with speed tier), pause, step, setSpeed, reset. Message types from Worker to main: tick (with YearSummary and events), paused, reset-done. In batch mode, the Worker SHALL aggregate YearSummary across the batch and send only the final summary plus collected events.

#### Scenario: Batch mode summary
- **WHEN** Worker runs 100 years in batch at Tier 1
- **THEN** it SHALL post a single message with the Year 100 summary and up to 50 prioritized events from the batch
