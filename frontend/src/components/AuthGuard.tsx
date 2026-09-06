interface AuthGuardProps {
  children: React.ReactNode
}

// 已临时去掉登录校验，直接进入系统
export default function AuthGuard({ children }: AuthGuardProps) {
  return <>{children}</>
}
