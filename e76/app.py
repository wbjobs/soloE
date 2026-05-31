import streamlit as st
import requests
import pandas as pd
import time
import io

BACKEND_URL = "http://localhost:8001"

st.set_page_config(
    page_title="Molecular LogP Predictor v2.0",
    page_icon="🧪",
    layout="wide"
)

st.markdown("""
<style>
    .main {
        padding: 2rem;
    }
    .stButton>button {
        width: 100%;
    }
    .logp-value {
        font-size: 2.5rem;
        font-weight: bold;
        text-align: center;
    }
    .solubility-class {
        font-size: 1.2rem;
        text-align: center;
        padding: 0.5rem;
        border-radius: 0.5rem;
        margin-top: 0.5rem;
    }
    .molecule-container {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 300px;
        background: #f8f9fa;
        border-radius: 0.5rem;
        padding: 1rem;
    }
    .task-status-pending {
        background-color: #fff3cd;
        color: #856404;
        padding: 1rem;
        border-radius: 0.5rem;
        text-align: center;
    }
    .task-status-processing {
        background-color: #d1ecf1;
        color: #0c5460;
        padding: 1rem;
        border-radius: 0.5rem;
        text-align: center;
    }
    .task-status-completed {
        background-color: #d4edda;
        color: #155724;
        padding: 1rem;
        border-radius: 0.5rem;
        text-align: center;
    }
    .task-status-failed {
        background-color: #f8d7da;
        color: #721c24;
        padding: 1rem;
        border-radius: 0.5rem;
        text-align: center;
    }
</style>
""", unsafe_allow_html=True)

st.markdown("""
<script src="https://unpkg.com/smiles-drawer@2.0.2/dist/smiles-drawer.min.js"></script>
""", unsafe_allow_html=True)


def predict_single(smiles: str):
    try:
        response = requests.post(
            f"{BACKEND_URL}/api/v1/predict",
            json={"smiles": smiles}
        )
        response.raise_for_status()
        return response.json()
    except Exception as e:
        st.error(f"Error: {str(e)}")
        return None


def submit_batch_prediction(smiles_list):
    try:
        response = requests.post(
            f"{BACKEND_URL}/api/v1/predict/batch/async",
            json={"smiles_list": smiles_list}
        )
        response.raise_for_status()
        return response.json()
    except Exception as e:
        st.error(f"Error: {str(e)}")
        return None


def submit_csv_prediction(file):
    try:
        response = requests.post(
            f"{BACKEND_URL}/api/v1/predict/upload/async",
            files={"file": file}
        )
        response.raise_for_status()
        return response.json()
    except Exception as e:
        st.error(f"Error: {str(e)}")
        return None


def get_task_status(task_id: str):
    try:
        response = requests.get(f"{BACKEND_URL}/api/v1/tasks/{task_id}")
        response.raise_for_status()
        return response.json()
    except Exception as e:
        st.error(f"Error: {str(e)}")
        return None


def search_similar_molecules(smiles: str, top_k: int = 5):
    try:
        response = requests.get(
            f"{BACKEND_URL}/api/v1/similar/search",
            params={"smiles": smiles, "top_k": top_k}
        )
        response.raise_for_status()
        return response.json()
    except Exception as e:
        st.error(f"Error: {str(e)}")
        return None


def get_library_info():
    try:
        response = requests.get(f"{BACKEND_URL}/api/v1/similar/library")
        response.raise_for_status()
        return response.json()
    except Exception as e:
        st.error(f"Error: {str(e)}")
        return None


def render_molecule_small(smiles: str, width: int = 200, height: int = 150, container_id: str = "mol"):
    html_code = f"""
    <div id="{container_id}" style="width: {width}px; height: {height}px; margin: 0 auto;"></div>
    <script>
        try {{
            if (typeof SmilesDrawer !== 'undefined') {{
                let drawer = new SmilesDrawer.Drawer({{
                    width: {width},
                    height: {height},
                    padding: 10
                }});
                SmilesDrawer.parse("{smiles}", function(tree) {{
                    drawer.draw(tree, "{container_id}");
                }}, function(error) {{
                    document.getElementById("{container_id}").innerHTML = 
                        '<div style="text-align:center; color:#999; padding-top:50px; font-size:12px;">N/A</div>';
                }});
            }} else {{
                document.getElementById("{container_id}").innerHTML = 
                    '<div style="text-align:center; color:#999; padding-top:50px; font-size:12px;">N/A</div>';
            }}
        }} catch(e) {{
            document.getElementById("{container_id}").innerHTML = 
                '<div style="text-align:center; color:#999; padding-top:50px; font-size:12px;">Error</div>';
        }}
    </script>
    """
    return html_code


def check_backend():
    try:
        response = requests.get(f"{BACKEND_URL}/health")
        return response.status_code == 200
    except Exception:
        return False


def render_molecule(smiles: str, width: int = 400, height: int = 300):
    html_code = f"""
    <div id="molecule-container" style="width: {width}px; height: {height}px; margin: 0 auto;"></div>
    <script>
        try {{
            if (typeof SmilesDrawer !== 'undefined') {{
                let drawer = new SmilesDrawer.Drawer({{
                    width: {width},
                    height: {height},
                    padding: 20
                }});
                SmilesDrawer.parse("{smiles}", function(tree) {{
                    drawer.draw(tree, "molecule-container");
                }}, function(error) {{
                    document.getElementById("molecule-container").innerHTML = 
                        '<div style="text-align:center; color:#999; padding-top:100px;">Could not render molecule structure</div>';
                }});
            }} else {{
                document.getElementById("molecule-container").innerHTML = 
                    '<div style="text-align:center; color:#999; padding-top:100px;">SmilesDrawer not loaded</div>';
            }}
        }} catch(e) {{
            document.getElementById("molecule-container").innerHTML = 
                '<div style="text-align:center; color:#999; padding-top:100px;">Error rendering molecule: ' + e.message + '</div>';
        }}
    </script>
    """
    st.components.v1.html(html_code, height=height + 20)


st.title("🧪 Molecular LogP Solubility Predictor v2.1")
st.markdown("---")

backend_status = check_backend()
if not backend_status:
    st.warning("⚠️ Backend service is not running. Please start the backend server first.")
    st.code("python main.py", language="bash")
    st.stop()

st.success("✅ Backend service is running")

tab1, tab2, tab3, tab4 = st.tabs(["Single Prediction", "Batch Prediction", "Task Status", "Similar Search"])

with tab1:
    st.header("Single Molecule Prediction")

    col1, col2 = st.columns([1, 1])

    with col1:
        st.subheader("Input")
        example_smiles = [
            "CCO",  # Ethanol
            "CC(=O)O",  # Acetic acid
            "c1ccccc1",  # Benzene
            "CC(C)C(=O)OC1=CC=CC=C1C(=O)O",  # Aspirin
            "CN1C=NC2=C1C(=O)N(C(=O)N2C)C",  # Caffeine
            "C1CCCCC1",  # Cyclohexane
            "OC[C@@H](O1)[C@@H](O)[C@H](O)[C@@H](O)[C@@H]1O"  # Glucose
        ]

        selected_example = st.selectbox("Example molecules", [""] + example_smiles)

        if selected_example:
            smiles_input = st.text_input("Enter SMILES string:", value=selected_example, key="smiles_input")
        else:
            smiles_input = st.text_input("Enter SMILES string:", value="", key="smiles_input")

        predict_btn = st.button("🔮 Predict LogP", type="primary")

        if predict_btn and smiles_input:
            with st.spinner("Predicting..."):
                result = predict_single(smiles_input)

                if result:
                    st.session_state.single_result = result
                    st.session_state.current_smiles = smiles_input

    with col2:
        st.subheader("Results")
        if "single_result" in st.session_state:
            result = st.session_state.single_result
            smiles = st.session_state.current_smiles

            if result["valid"]:
                st.markdown("**2D Molecular Structure**")
                render_molecule(smiles, width=400, height=300)

                logp_color = "#00cc66" if result["logp"] < 2 else "#ff9900" if result["logp"] < 4 else "#ff4444"
                st.markdown(
                    f"<div class='logp-value' style='color: {logp_color};'>"
                    f"logP = {result['logp']:.4f}"
                    f"</div>",
                    unsafe_allow_html=True
                )

                class_color = {
                    "Highly Soluble": "#00cc66",
                    "Soluble": "#3399ff",
                    "Moderately Soluble": "#ff9900",
                    "Poorly Soluble": "#ff4444"
                }.get(result["solubility_class"], "#888888")

                st.markdown(
                    f"<div class='solubility-class' style='background-color: {class_color}20; color: {class_color};'>"
                    f"📊 {result['solubility_class']}"
                    f"</div>",
                    unsafe_allow_html=True
                )

                st.info("""
                **Solubility Guidelines:**
                - logP < 0: Highly Soluble
                - 0 ≤ logP < 2: Soluble
                - 2 ≤ logP < 4: Moderately Soluble
                - logP ≥ 4: Poorly Soluble
                """)
            else:
                st.error("❌ Invalid SMILES string. Please check your input.")

    st.markdown("---")
    st.markdown("### What is logP?")
    st.info("""
    **logP (Partition Coefficient)** is the ratio of a compound's concentration in the octanol phase to its concentration in the aqueous phase at equilibrium.

    - **Negative logP**: Hydrophilic (water-soluble)
    - **Positive logP**: Lipophilic (fat-soluble)
    - **Drug-like molecules**: Typically have logP values between -1 and 5
    """)

with tab2:
    st.header("Batch Prediction (Async)")

    col1, col2 = st.columns([1, 1])

    with col1:
        st.subheader("Submit Prediction Task")

        input_mode = st.radio("Input mode", ["Text Input", "CSV Upload"])

        if input_mode == "Text Input":
            st.info("Enter one SMILES per line")
            smiles_text = st.text_area("SMILES list:", height=200, placeholder="CCO\nc1ccccc1\nCC(=O)O")

            if st.button("🚀 Submit Batch Task", type="primary"):
                if smiles_text.strip():
                    smiles_list = [s.strip() for s in smiles_text.strip().split("\n") if s.strip()]
                    if len(smiles_list) > 0:
                        result = submit_batch_prediction(smiles_list)
                        if result:
                            st.success(f"✅ Task submitted! Task ID: {result['task_id']}")
                            st.info(f"Go to 'Task Status' tab to check progress")
                            st.session_state.last_task_id = result['task_id']
                else:
                    st.warning("Please enter at least one SMILES")

        else:
            st.info("CSV file should contain a 'smiles' column (case-insensitive)")
            uploaded_file = st.file_uploader("Choose a CSV file", type="csv")

            if uploaded_file is not None:
                try:
                    input_df = pd.read_csv(uploaded_file)
                    st.dataframe(input_df, use_container_width=True)

                    if st.button("🚀 Submit CSV Task", type="primary"):
                        uploaded_file.seek(0)
                        result = submit_csv_prediction(uploaded_file)
                        if result:
                            st.success(f"✅ Task submitted! Task ID: {result['task_id']}")
                            st.info(f"Go to 'Task Status' tab to check progress")
                            st.session_state.last_task_id = result['task_id']

                except Exception as e:
                    st.error(f"Error reading CSV: {str(e)}")

    with col2:
        st.subheader("Quick Task Check")
        task_id_input = st.text_input("Enter Task ID:", value=st.session_state.get("last_task_id", ""))

        if task_id_input and st.button("🔍 Check Status"):
            status = get_task_status(task_id_input)
            if status:
                if status["status"] == "pending":
                    st.markdown(
                        f"<div class='task-status-pending'>⏳ PENDING<br>{status.get('message', 'Waiting in queue...')}</div>",
                        unsafe_allow_html=True
                    )
                elif status["status"] == "processing":
                    progress = status.get("progress", 0)
                    st.markdown(
                        f"<div class='task-status-processing'>🔄 PROCESSING<br>"
                        f"{status.get('message', 'Processing...')}<br>"
                        f"Progress: {status.get('current', 0)}/{status.get('total', 0)} ({progress}%)</div>",
                        unsafe_allow_html=True
                    )
                    st.progress(progress / 100)
                elif status["status"] == "completed":
                    st.markdown(
                        f"<div class='task-status-completed'>✅ COMPLETED<br>"
                        f"Total: {status.get('total_count', 0)}, Success: {status.get('success_count', 0)}</div>",
                        unsafe_allow_html=True
                    )

                    if "results" in status:
                        results_df = pd.DataFrame(status["results"])
                        st.dataframe(results_df, use_container_width=True)

                        st.download_button(
                            label="⬇️ Download Results as CSV",
                            data=results_df.to_csv(index=False),
                            file_name=f"logp_predictions_{task_id_input}.csv",
                            mime="text/csv"
                        )
                elif status["status"] == "failed":
                    st.markdown(
                        f"<div class='task-status-failed'>❌ FAILED<br>{status.get('error', 'Unknown error')}</div>",
                        unsafe_allow_html=True
                    )
                else:
                    st.info(f"Status: {status['status']}")

    st.markdown("---")
    st.markdown("### Example CSV Format")
    example_csv = pd.DataFrame({
        "smiles": [
            "CCO",
            "CC(=O)O",
            "c1ccccc1",
            "CC(C)C(=O)OC1=CC=CC=C1C(=O)O",
            "CN1C=NC2=C1C(=O)N(C(=O)N2C)C"
        ]
    })
    st.code(example_csv.to_csv(index=False), language="csv")

    st.download_button(
        label="📄 Download Example CSV",
        data=example_csv.to_csv(index=False),
        file_name="example_molecules.csv",
        mime="text/csv",
        key="download_example_batch"
    )

with tab3:
    st.header("Task Status Monitor")

    task_id_monitor = st.text_input("Task ID to monitor:", value=st.session_state.get("last_task_id", ""), key="monitor_task_id")

    if task_id_monitor:
        auto_refresh = st.checkbox("Auto-refresh", value=True)

        status_placeholder = st.empty()
        progress_placeholder = st.empty()
        results_placeholder = st.empty()

        if auto_refresh:
            refresh_interval = st.slider("Refresh interval (seconds)", 1, 10, 2)

            while True:
                status = get_task_status(task_id_monitor)
                if status:
                    with status_placeholder.container():
                        if status["status"] == "pending":
                            st.markdown(
                                f"<div class='task-status-pending'>⏳ PENDING<br>{status.get('message', 'Waiting in queue...')}</div>",
                                unsafe_allow_html=True
                            )
                        elif status["status"] == "processing":
                            progress = status.get("progress", 0)
                            st.markdown(
                                f"<div class='task-status-processing'>🔄 PROCESSING<br>"
                                f"{status.get('message', 'Processing...')}<br>"
                                f"Progress: {status.get('current', 0)}/{status.get('total', 0)} ({progress}%)</div>",
                                unsafe_allow_html=True
                            )
                            progress_placeholder.progress(progress / 100)
                        elif status["status"] == "completed":
                            st.markdown(
                                f"<div class='task-status-completed'>✅ COMPLETED<br>"
                                f"Total: {status.get('total_count', 0)}, Success: {status.get('success_count', 0)}</div>",
                                unsafe_allow_html=True
                            )
                            progress_placeholder.empty()

                            if "results" in status:
                                results_df = pd.DataFrame(status["results"])
                                with results_placeholder.container():
                                    st.dataframe(results_df, use_container_width=True)

                                    st.download_button(
                                        label="⬇️ Download Results as CSV",
                                        data=results_df.to_csv(index=False),
                                        file_name=f"logp_predictions_{task_id_monitor}.csv",
                                        mime="text/csv",
                                        key=f"download_{task_id_monitor}"
                                    )
                            break
                        elif status["status"] == "failed":
                            st.markdown(
                                f"<div class='task-status-failed'>❌ FAILED<br>{status.get('error', 'Unknown error')}</div>",
                                unsafe_allow_html=True
                            )
                            progress_placeholder.empty()
                            break
                        else:
                            st.info(f"Status: {status['status']}")

                if status and status["status"] in ["completed", "failed"]:
                    break

                time.sleep(refresh_interval)
                st.rerun()
        else:
            status = get_task_status(task_id_monitor)
            if status:
                if status["status"] == "pending":
                    st.markdown(
                        f"<div class='task-status-pending'>⏳ PENDING<br>{status.get('message', 'Waiting in queue...')}</div>",
                        unsafe_allow_html=True
                    )
                elif status["status"] == "processing":
                    progress = status.get("progress", 0)
                    st.markdown(
                        f"<div class='task-status-processing'>🔄 PROCESSING<br>"
                        f"{status.get('message', 'Processing...')}<br>"
                        f"Progress: {status.get('current', 0)}/{status.get('total', 0)} ({progress}%)</div>",
                        unsafe_allow_html=True
                    )
                    st.progress(progress / 100)
                elif status["status"] == "completed":
                    st.markdown(
                        f"<div class='task-status-completed'>✅ COMPLETED<br>"
                        f"Total: {status.get('total_count', 0)}, Success: {status.get('success_count', 0)}</div>",
                        unsafe_allow_html=True
                    )

                    if "results" in status:
                        results_df = pd.DataFrame(status["results"])
                        st.dataframe(results_df, use_container_width=True)

                        st.download_button(
                            label="⬇️ Download Results as CSV",
                            data=results_df.to_csv(index=False),
                            file_name=f"logp_predictions_{task_id_monitor}.csv",
                            mime="text/csv",
                            key=f"download_{task_id_monitor}_manual"
                        )
                elif status["status"] == "failed":
                    st.markdown(
                        f"<div class='task-status-failed'>❌ FAILED<br>{status.get('error', 'Unknown error')}</div>",
                        unsafe_allow_html=True
                    )
                else:
                    st.info(f"Status: {status['status']}")

with tab4:
    st.header("🔍 Similar Molecule Search")
    st.markdown("Search for similar molecules in our library using embedding-based similarity search.")

    col1, col2 = st.columns([1, 1])

    with col1:
        st.subheader("Query Input")

        example_smiles = [
            "CCO",  # Ethanol
            "CC(=O)O",  # Acetic acid
            "c1ccccc1",  # Benzene
            "CC(C)C(=O)OC1=CC=CC=C1C(=O)O",  # Aspirin
            "CN1C=NC2=C1C(=O)N(C(=O)N2C)C",  # Caffeine
            "C1CCCCC1",  # Cyclohexane
            "CC(=O)NC1=CC=C(C=C1)O"  # Acetaminophen
        ]

        selected_example = st.selectbox("Example query molecules", [""] + example_smiles, key="similar_example")

        if selected_example:
            query_smiles = st.text_input("Enter query SMILES:", value=selected_example, key="similar_smiles_input")
        else:
            query_smiles = st.text_input("Enter query SMILES:", value="", key="similar_smiles_input")

        top_k = st.slider("Number of similar molecules (top-K)", min_value=1, max_value=10, value=5)

        search_btn = st.button("🔎 Search Similar Molecules", type="primary")

        if search_btn and query_smiles:
            with st.spinner("Searching..."):
                result = search_similar_molecules(query_smiles, top_k=top_k)
                if result:
                    st.session_state.similar_results = result
                    st.session_state.similar_query = query_smiles

        library_info = get_library_info()
        if library_info:
            st.info(f"📚 Molecule Library: **{library_info['total_molecules']}** compounds available")

    with col2:
        st.subheader("Query Molecule")
        if "similar_query" in st.session_state and st.session_state.similar_query:
            render_molecule(st.session_state.similar_query, width=300, height=250)
            st.markdown(f"**SMILES:** `{st.session_state.similar_query}`")

    st.markdown("---")

    if "similar_results" in st.session_state:
        st.subheader("📊 Search Results")

        results = st.session_state.similar_results
        query_smiles = st.session_state.similar_query

        st.success(f"Found {len(results['results'])} similar molecules (backend: {results['backend']})")

        results_df = pd.DataFrame(results['results'])
        st.dataframe(
            results_df[['rank', 'name', 'smiles', 'logp', 'solubility_class', 'similarity']],
            use_container_width=True,
            column_config={
                'similarity': st.column_config.NumberColumn('Similarity', format='%.4f')
            }
        )

        st.markdown("### 🔬 2D Structures of Results")

        num_cols = 3
        result_items = results['results']

        for i in range(0, len(result_items), num_cols):
            cols = st.columns(num_cols)
            for j in range(num_cols):
                if i + j < len(result_items):
                    item = result_items[i + j]
                    with cols[j]:
                        container_id = f"mol_result_{i}_{j}"
                        st.markdown(f"**Rank {item['rank']}: {item['name']}**")
                        html_content = render_molecule_small(item['smiles'], width=200, height=150, container_id=container_id)
                        st.components.v1.html(html_content, height=170)
                        st.markdown(f"**logP:** {item['logp']:.4f}")
                        st.markdown(f"**Similarity:** {item['similarity']:.4f}")
                        class_color = {
                            "Highly Soluble": "#00cc66",
                            "Soluble": "#3399ff",
                            "Moderately Soluble": "#ff9900",
                            "Poorly Soluble": "#ff4444"
                        }.get(item['solubility_class'], "#888888")
                        st.markdown(
                            f"<div style='background-color: {class_color}20; color: {class_color}; "
                            f"padding: 0.3rem; border-radius: 0.3rem; text-align: center; font-size: 0.8rem;'>"
                            f"{item['solubility_class']}"
                            f"</div>",
                            unsafe_allow_html=True
                        )

st.markdown("---")
st.markdown("### About This Service")
st.info("""
This service uses a pre-trained Graph Neural Network (GNN) model to predict the logP solubility value of small molecules.

**New in v2.1:**
- Similar molecule search using FAISS or numpy backend
- Embedding feature extraction from model's hidden layers
- 50+ molecule library with known logP values
- 2D structure visualization for search results

**New in v2.0:**
- PyTorch MLP model with explicit CPU device mapping (map_location='cpu')
- Async batch processing with Celery + Redis
- Task status monitoring with progress tracking
- Frontend molecule rendering using SmilesDrawer library
- Backend only returns SMILES and prediction values

**Features:**
- Single molecule prediction
- Async batch prediction (text input or CSV upload)
- Automatic SMILES validation
- Solubility classification based on logP values

**API Endpoints:**
- `POST /api/v1/predict` - Single molecule prediction
- `POST /api/v1/predict/batch/async` - Submit async batch prediction
- `POST /api/v1/predict/upload/async` - Submit async CSV prediction
- `GET /api/v1/tasks/{task_id}` - Get task status
- `GET /api/v1/tasks/{task_id}/download` - Download task results as CSV
""")
