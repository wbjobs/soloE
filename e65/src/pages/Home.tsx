import { Toolbar } from '../components/Toolbar';
import { SidePanel } from '../components/SidePanel';
import { StatusBar } from '../components/StatusBar';
import { PointCloudScene } from '../components/PointCloudScene';

export default function Home() {
  return (
    <div className="h-screen w-screen flex flex-col bg-slate-900 overflow-hidden">
      <Toolbar />
      
      <div className="flex-1 flex overflow-hidden">
        <SidePanel />
        
        <div className="flex-1 relative">
          <PointCloudScene />
          
          <div className="absolute top-4 left-4 bg-slate-800/90 backdrop-blur-sm rounded-lg p-3 text-sm">
            <div className="text-slate-400 mb-2 font-medium">操作说明</div>
            <div className="space-y-1 text-slate-300">
              <div>🖱️ 左键拖动: 旋转视角</div>
              <div>🖱️ 右键拖动: 平移视角</div>
              <div>🖱️ 滚轮: 缩放</div>
              <div>📊 点云分类: 使用RANSAC自动分类</div>
              <div>👥 协同编辑: 连接房间实时同步</div>
            </div>
          </div>
        </div>
      </div>
      
      <StatusBar />
    </div>
  );
}