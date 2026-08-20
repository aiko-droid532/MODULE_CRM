'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './Layout.module.css';
import {
  AnalyticsIcon,
  ClientsIcon,
  DealsIcon,
  GridIcon,
  FinanceIcon,
  ReportsIcon,
  LogoIcon
} from '../Icons';

import NotificationBell from './NotificationBell';
import { hasNavAccess, UserRole, ROLE_LABELS } from '@/lib/roles';

interface LayoutProps {
  children: React.ReactNode;
  userRole?: string;
}

const NAV_ITEMS = [
  { name: 'Аналитика',            path: '/',             icon: <AnalyticsIcon />, section: 'analytics'  },
  { name: 'Управление клиентами', path: '/clients',      icon: <ClientsIcon />,   section: 'clients'    },
  { name: 'Сделки',               path: '/deals',        icon: <DealsIcon />,     section: 'deals'      },
  { name: 'Шахматка',             path: '/shakhmatka',   icon: <GridIcon />,      section: 'shakhmatka' },
  { name: 'Ценообразование',      path: '/pricing',      icon: <FinanceIcon />,   section: 'pricing'    },
  { name: 'Договоры',             path: '/contracts',    icon: <ReportsIcon />,   section: 'contracts'  },
  { name: 'Финансы',              path: '/finance',      icon: <FinanceIcon />,   section: 'finance'    },
  { name: 'Задолженность',        path: '/debts',        icon: <FinanceIcon />,   section: 'debts'      },
  { name: 'Отчеты',               path: '/reports',      icon: <ReportsIcon />,   section: 'reports'    },
  { name: 'Интеграция Georgia',    path: '/integration',  icon: <AnalyticsIcon />, section: 'analytics'  },
];

const Layout: React.FC<LayoutProps> = ({ children, userRole = 'manager' }) => {
  const pathname = usePathname();
  const role = userRole as UserRole;

  React.useEffect(() => {
    const sectionMap: Record<string, string> = {
      '/': 'Аналитика',
      '/clients': 'Управление клиентами',
      '/deals': 'Сделки',
      '/shakhmatka': 'Шахматка',
      '/pricing': 'Ценообразование',
      '/contracts': 'Договоры',
      '/finance': 'Финансы',
      '/reports': 'Отчеты',
      '/integration': 'Интеграция Georgia'
    };
    const sectionName = sectionMap[pathname] || pathname;
    fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actionName: `Пользователь перешел в раздел: "${sectionName}"`,
        details: { path: pathname }
      })
    }).catch(() => {});
  }, [pathname]);

  // Фильтруем навигацию по роли
  const visibleNav = NAV_ITEMS.filter(item => hasNavAccess(role, item.section));

  return (
    <div className={styles.container}>
      <nav className={styles.topNav}>
        <div className={styles.navLeft}>
          <div className={styles.logo}>
            <span className={styles.logoIcon}><LogoIcon size={22} /></span>
            <span className={styles.logoText}>CRM</span>
          </div>
          <div className={styles.menuItems}>
            {visibleNav.map((item) => (
              <Link
                key={item.path}
                href={item.path}
                className={`${styles.navLink} ${pathname === item.path ? styles.active : ''}`}
              >
                <span className={styles.icon}>{item.icon}</span>
                {item.name}
              </Link>
            ))}
          </div>
        </div>
        
        <div className={styles.navRight}>
          <div className={styles.searchBox}>
            <input type="text" placeholder="Поиск..." />
          </div>
          <NotificationBell managerId="system" organizationId="741be209-ad6f-4483-92ee-298a36899bcf" />
          <div className={styles.userProfile}>
            <div className={styles.avatar} title={ROLE_LABELS[role] || role}>
              АИ
            </div>
          </div>
        </div>
      </nav>

      <main className={styles.main}>
        <div className={styles.content}>{children}</div>
      </main>
    </div>
  );
};

export default Layout;