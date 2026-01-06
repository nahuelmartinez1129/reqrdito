document.getElementById('audioForm').addEventListener('submit',async e=>{
e.preventDefault();
const data=new FormData(e.target);
const res=await fetch('http://localhost:5000/upload',{method:'POST',body:data});
const json=await res.json();
if(json.init_point) location.href=json.init_point;
});