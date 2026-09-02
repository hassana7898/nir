import React from 'react';
import { Routes, Route, Navigate, NavLink } from 'react-router-dom';
import Sidebar from './Sidebar';
import EntryPage from '../pages/EntryPage';
import ExitPage from '../pages/ExitPage';
import ReportsPage from '../pages/ReportsPage';
import LogPage from '../pages/LogPage';
import SettingsPage from '../pages/SettingsPage';
import InventoryPage from '../pages/InventoryPage';
import ProductionPage from '../pages/ProductionPage';
import InventoryAnalysisPage from '../pages/InventoryAnalysisPage';
import FarmersPage from '../pages/FarmersPage';
import ActiveBroodsPage from '../pages/ActiveBroodsPage';
import DashboardPage from '../pages/DashboardPage';
import GlobalSearchPage from '../pages/GlobalSearchPage';
import BackupPage from '../pages/BackupPage';

const MainLayout: React.FC = () => {
    return (
        <div className="flex h-screen transition-opacity duration-500 opacity-100">
            <Sidebar />
            <main className="relative flex-1 p-6 overflow-y-auto bg-slate-100">
                <NavLink to="/backup" className="fixed left-4 top-4 z-40 rounded-xl bg-white border border-slate-200 shadow-md px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 no-print" title="پشتیبان‌گیری خودکار">
                    🛡️ پشتیبان
                </NavLink>
                <Routes>
                    <Route path="/" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/dashboard" element={<DashboardPage />} />
                    <Route path="/entry" element={<EntryPage />} />
                    <Route path="/exit" element={<ExitPage />} />
                    <Route path="/farmers" element={<FarmersPage />} />
                    <Route path="/broods" element={<ActiveBroodsPage />} />
                    <Route path="/inventory" element={<InventoryPage />} />
                    <Route path="/inventory-analysis" element={<InventoryAnalysisPage />} />
                    <Route path="/production" element={<ProductionPage />} />
                    <Route path="/global-search" element={<GlobalSearchPage />} />
                    <Route path="/reports" element={<ReportsPage />} />
                    <Route path="/log" element={<LogPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/backup" element={<BackupPage />} />
                </Routes>
            </main>
        </div>
    );
};

export default MainLayout;
