import requests
import base64
import json
import time
from typing import List, Dict, Optional, Tuple, Callable


class APIClient:
    """与后端服务通信的API客户端"""

    def __init__(self, base_url: str = "http://localhost:8000"):
        self.base_url = base_url.rstrip('/')
        self.session = requests.Session()

    def upload_image(self, image_name: str, blocks: List[Dict],
                     total_blocks: int, block_size: int = 4096,
                     redundancy_rate: float = 0.2,
                     use_interleave: bool = False,
                     interleave_group_size: int = 64,
                     interleave_map: Optional[Dict] = None,
                     use_async: bool = False) -> Dict:
        """上传镜像的校验数据到后端"""
        if use_async:
            return self.upload_image_async(
                image_name=image_name,
                blocks=blocks,
                total_blocks=total_blocks,
                block_size=block_size,
                redundancy_rate=redundancy_rate,
                use_interleave=use_interleave,
                interleave_group_size=interleave_group_size,
                interleave_map=interleave_map
            )

        url = f"{self.base_url}/api/images/upload"
        payload = {
            "name": image_name,
            "total_blocks": total_blocks,
            "block_size": block_size,
            "redundancy_rate": redundancy_rate,
            "use_interleave": use_interleave,
            "interleave_group_size": interleave_group_size,
            "interleave_map": interleave_map,
            "blocks": blocks
        }
        response = self.session.post(url, json=payload)
        response.raise_for_status()
        return response.json()

    def upload_image_async(self, image_name: str, blocks: List[Dict],
                           total_blocks: int, block_size: int = 4096,
                           redundancy_rate: float = 0.2,
                           use_interleave: bool = False,
                           interleave_group_size: int = 64,
                           interleave_map: Optional[Dict] = None) -> Dict:
        """异步上传镜像的校验数据到后端"""
        url = f"{self.base_url}/api/images/upload/async"
        payload = {
            "name": image_name,
            "total_blocks": total_blocks,
            "block_size": block_size,
            "redundancy_rate": redundancy_rate,
            "use_interleave": use_interleave,
            "interleave_group_size": interleave_group_size,
            "interleave_map": interleave_map,
            "blocks": blocks
        }
        response = self.session.post(url, json=payload)
        response.raise_for_status()
        return response.json()

    def get_task_status(self, task_id: str) -> Dict:
        """获取异步任务状态"""
        url = f"{self.base_url}/api/tasks/{task_id}"
        response = self.session.get(url)
        response.raise_for_status()
        return response.json()

    def list_tasks(self, image_name: Optional[str] = None,
                   status: Optional[str] = None) -> List[Dict]:
        """列出所有异步任务"""
        url = f"{self.base_url}/api/tasks"
        params = {}
        if image_name:
            params["image_name"] = image_name
        if status:
            params["status"] = status
        response = self.session.get(url, params=params)
        response.raise_for_status()
        return response.json()

    def wait_for_task(self, task_id: str, timeout: int = 3600,
                      poll_interval: int = 2,
                      progress_callback: Optional[Callable] = None) -> Dict:
        """
        等待异步任务完成

        Args:
            task_id: 任务ID
            timeout: 超时时间（秒）
            poll_interval: 轮询间隔（秒）
            progress_callback: 进度回调函数 (current, total)

        Returns:
            任务结果
        """
        start_time = time.time()
        while time.time() - start_time < timeout:
            status = self.get_task_status(task_id)

            if progress_callback and status.get("total", 0) > 0:
                progress_callback(status.get("progress", 0), status.get("total", 0))

            if status["status"] == "completed":
                return status
            elif status["status"] == "failed":
                raise Exception(f"任务失败: {status.get('error', '未知错误')}")

            time.sleep(poll_interval)

        raise TimeoutError(f"等待任务超时 ({timeout}秒)")

    def list_images(self) -> List[Dict]:
        """列出所有已存储的镜像"""
        url = f"{self.base_url}/api/images"
        response = self.session.get(url)
        response.raise_for_status()
        return response.json()

    def get_image_info(self, image_name: str) -> Dict:
        """获取镜像信息"""
        url = f"{self.base_url}/api/images/{image_name}"
        response = self.session.get(url)
        response.raise_for_status()
        return response.json()

    def get_image_blocks(self, image_name: str,
                         block_indices: Optional[List[int]] = None) -> List[Dict]:
        """获取镜像的块信息和校验数据"""
        url = f"{self.base_url}/api/images/{image_name}/blocks"
        params = {}
        if block_indices:
            params["block_indices"] = ",".join(map(str, block_indices))
        response = self.session.get(url, params=params)
        response.raise_for_status()
        return response.json()

    def prepare_recovery(self, image_name: str,
                         corrupted_blocks: List[int]) -> Dict:
        """准备恢复数据"""
        url = f"{self.base_url}/api/recovery/prepare"
        payload = {
            "image_name": image_name,
            "corrupted_blocks": corrupted_blocks
        }
        response = self.session.post(url, json=payload)
        response.raise_for_status()
        return response.json()

    def delete_image(self, image_name: str) -> Dict:
        """删除镜像"""
        url = f"{self.base_url}/api/images/{image_name}"
        response = self.session.delete(url)
        response.raise_for_status()
        return response.json()

    def health_check(self) -> bool:
        """健康检查"""
        try:
            url = f"{self.base_url}/api/health"
            response = self.session.get(url, timeout=5)
            return response.status_code == 200
        except requests.RequestException:
            return False

    def get_server_version(self) -> Optional[str]:
        """获取服务器版本"""
        try:
            url = f"{self.base_url}/api/health"
            response = self.session.get(url, timeout=5)
            if response.status_code == 200:
                return response.json().get("version")
        except requests.RequestException:
            pass
        return None

    # ==================== 分布式重建 API ====================

    def create_rebuild_task(self, image_name: str, name: str) -> Dict:
        """创建分布式镜像重建任务"""
        url = f"{self.base_url}/api/rebuild/create"
        payload = {
            "image_name": image_name,
            "name": name
        }
        response = self.session.post(url, json=payload)
        response.raise_for_status()
        return response.json()

    def upload_fragment(self, rebuild_task_id: str, node_id: str,
                        block_index: int, block_data: bytes,
                        node_name: Optional[str] = None,
                        block_hash: Optional[str] = None) -> Dict:
        """上传单个块片段"""
        url = f"{self.base_url}/api/rebuild/fragment/upload"
        payload = {
            "rebuild_task_id": rebuild_task_id,
            "node_id": node_id,
            "node_name": node_name,
            "block_index": block_index,
            "block_data": base64.b64encode(block_data).decode('utf-8'),
            "block_hash": block_hash
        }
        response = self.session.post(url, json=payload)
        response.raise_for_status()
        return response.json()

    def upload_fragment_batch(self, rebuild_task_id: str, node_id: str,
                              fragments: List[Dict],
                              node_name: Optional[str] = None) -> Dict:
        """批量上传块片段"""
        url = f"{self.base_url}/api/rebuild/fragment/batch"
        prepared_fragments = []
        for frag in fragments:
            prepared_fragments.append({
                "rebuild_task_id": rebuild_task_id,
                "node_id": node_id,
                "node_name": node_name,
                "block_index": frag["block_index"],
                "block_data": base64.b64encode(frag["block_data"]).decode('utf-8'),
                "block_hash": frag.get("block_hash")
            })
        payload = {
            "rebuild_task_id": rebuild_task_id,
            "node_id": node_id,
            "node_name": node_name,
            "fragments": prepared_fragments
        }
        response = self.session.post(url, json=payload)
        response.raise_for_status()
        return response.json()

    def get_rebuild_status(self, task_id: str) -> Dict:
        """获取重建任务状态"""
        url = f"{self.base_url}/api/rebuild/{task_id}"
        response = self.session.get(url)
        response.raise_for_status()
        return response.json()

    def list_rebuild_tasks(self, image_name: Optional[str] = None,
                           status: Optional[str] = None) -> List[Dict]:
        """列出所有重建任务"""
        url = f"{self.base_url}/api/rebuild"
        params = {}
        if image_name:
            params["image_name"] = image_name
        if status:
            params["status"] = status
        response = self.session.get(url, params=params)
        response.raise_for_status()
        return response.json()

    def start_rebuild(self, rebuild_task_id: str) -> Dict:
        """开始执行联合解码重建"""
        url = f"{self.base_url}/api/rebuild/start"
        payload = {
            "rebuild_task_id": rebuild_task_id
        }
        response = self.session.post(url, json=payload)
        response.raise_for_status()
        return response.json()

    def download_rebuilt_image(self, task_id: str, output_path: str) -> str:
        """下载重建完成的镜像"""
        url = f"{self.base_url}/api/rebuild/{task_id}/download"
        response = self.session.get(url, stream=True)
        response.raise_for_status()

        with open(output_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)

        return output_path

    def get_node_contributions(self, task_id: str) -> List[Dict]:
        """获取各节点的贡献统计"""
        url = f"{self.base_url}/api/rebuild/{task_id}/nodes"
        response = self.session.get(url)
        response.raise_for_status()
        return response.json()

    def get_block_heatmap(self, task_id: str) -> Dict:
        """获取块收集热力图数据"""
        url = f"{self.base_url}/api/rebuild/{task_id}/heatmap"
        response = self.session.get(url)
        response.raise_for_status()
        return response.json()

