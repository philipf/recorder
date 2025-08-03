# Recorder

A simple web-based recorder application.

## Prerequisites

- Node.js (v14 or higher recommended)
- npm (comes with Node.js)

## Getting Started

1. **Clone the repository** (if you haven't already)
   ```bash
   git clone <repository-url>
   cd recorder
   ```

2. **Install http-server globally**
   ```bash
   npm install -g http-server
   ```

## Running the Application

### Option 1: Using http-server (Recommended)

1. Navigate to the project directory
   ```bash
   cd /path/to/recorder
   ```

2. Start the server
   ```bash
   http-server -p 8080
   ```

3. Open your browser and visit:
   ```
   http://localhost:8080
   ```

### Option 2: Using Node.js http-server module

1. Install http-server as a development dependency
   ```bash
   npm install --save-dev http-server
   ```

2. Add a start script to your `package.json`:
   ```json
   "scripts": {
     "start": "http-server -p 8080"
   }
   ```

3. Start the server
   ```bash
   npm start
   ```

4. Open your browser and visit:
   ```
   http://localhost:8080
   ```

## Development

- The main application files are:
  - `index.html` - Main HTML file
  - `style.css` - Styling
  - `script.js` - Application logic
  - `sw.js` - Service worker for offline functionality

## License

[Add your license information here]
