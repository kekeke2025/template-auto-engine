import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/login'
import Layout from './pages/layout'
import TemplateList from './pages/template/list'
import TemplateUpload from './pages/template/upload'
import TemplateUse from './pages/template/use'
import GenerateRecord from './pages/record'
import AuthGuard from './components/AuthGuard'

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={
          <AuthGuard>
            <Layout />
          </AuthGuard>
        }>
          <Route index element={<Navigate to="/template/list" replace />} />
          <Route path="/template/list" element={<TemplateList />} />
          <Route path="/template/upload" element={<TemplateUpload />} />
          <Route path="/template/use/:id" element={<TemplateUse />} />
          <Route path="/record" element={<GenerateRecord />} />
        </Route>
      </Routes>
    </Router>
  )
}

export default App
