import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) return (
      <div style={{ color: '#f55', background: '#111', padding: '2rem', fontFamily: 'monospace', fontSize: '14px', whiteSpace: 'pre-wrap' }}>
        <b>Runtime Error:</b>{'\n'}{this.state.error?.message}{'\n\n'}{this.state.error?.stack}
      </div>
    );
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
