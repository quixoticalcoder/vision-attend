import base64
import csv
import io
import time
from unittest.mock import patch

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from web.app import app, SESSIONS, TTL, expire_sessions, extract_face

HEADERS = {'X-Vision-Request': '1'}

@pytest.fixture
def client():
    SESSIONS.clear()
    with TestClient(app, base_url='https://testserver') as client:
        yield client
    SESSIONS.clear()


def enroll(client, name='Student One'):
    return client.post('/api/enroll', headers=HEADERS, json={'id':'S1','name':name,'department':'Engineering','consent':True,'images':['image']*3})


def test_real_lbph_workflow_requires_confirmation_and_deduplicates(client):
    sample=np.random.default_rng(7).integers(0,256,(160,160),dtype=np.uint8)
    with patch('web.app.extract_face', return_value=sample):
        assert enroll(client).status_code == 200
        match=client.post('/api/recognize',headers=HEADERS,json={'image':'image','consent':True}).json()
        assert match['matched'] and match['student']['id']=='S1'
        assert client.get('/api/session').json()['attendance']==[]
        assert client.post('/api/attendance',headers=HEADERS,json={'token':'wrong'}).status_code==409
        assert client.post('/api/attendance',headers=HEADERS,json={'token':match['token']}).status_code==200
        assert client.post('/api/attendance',headers=HEADERS,json={'token':match['token']}).status_code==409
        match=client.post('/api/recognize',headers=HEADERS,json={'image':'image','consent':True}).json()
        client.post('/api/attendance',headers=HEADERS,json={'token':match['token']})
        assert len(client.get('/api/session').json()['attendance'])==1


def test_isolation_and_deletion(client):
    sample=np.zeros((160,160),dtype=np.uint8)
    with patch('web.app.extract_face', return_value=sample):
        assert enroll(client).status_code==200
    other=TestClient(app,base_url='https://testserver')
    assert other.get('/api/session').json()['students']==[]
    assert len(client.get('/api/session').json()['students'])==1
    assert client.delete('/api/session',headers=HEADERS).status_code==200
    assert client.get('/api/session').json()['students']==[]


def test_export_escapes_formula_and_quotes(client):
    sample=np.zeros((160,160),dtype=np.uint8)
    with patch('web.app.extract_face', return_value=sample):
        enroll(client,'=SUM(1,2)')
        match=client.post('/api/recognize',headers=HEADERS,json={'image':'image','consent':True}).json()
        client.post('/api/attendance',headers=HEADERS,json={'token':match['token']})
    result=client.get('/api/export')
    rows=list(csv.reader(io.StringIO(result.text)))
    assert result.status_code==200 and rows[1][1]=="'=SUM(1,2)"


def test_no_face_or_invalid_image_rejected(client):
    image=Image.new('RGB',(200,200),'white')
    stream=io.BytesIO();image.save(stream,format='PNG')
    encoded='data:image/png;base64,'+base64.b64encode(stream.getvalue()).decode()
    result=client.post('/api/enroll',headers=HEADERS,json={'id':'S1','name':'A','consent':True,'images':[encoded]*3})
    assert result.status_code==422 and 'Exactly one' in result.json()['detail']
    assert enroll(client).status_code==422
    assert client.get('/api/session').json()['students']==[]


def test_limits_consent_and_csrf(client):
    assert client.post('/api/enroll',json={}).status_code==403
    assert client.post('/api/recognize',headers=HEADERS,json={'image':'x','consent':False}).status_code==422
    assert client.post('/api/enroll',headers=HEADERS,content=b'x'*2_000_001).status_code==413


def test_expiration_and_secure_cookie(client):
    result=client.get('/api/session')
    cookie=result.headers['set-cookie']
    assert 'Secure' in cookie and 'HttpOnly' in cookie and 'SameSite=strict' in cookie
    for data in SESSIONS.values(): data['touched']=time.monotonic()-TTL-1
    expire_sessions()
    assert not SESSIONS


def test_frontend_and_health(client):
    assert client.get('/health').json()['status']=='ok'
    result=client.get('/')
    assert 'Vision Attend' in result.text
    assert "frame-ancestors 'none'" in result.headers['content-security-policy']
    assert client.get('/static/app.js').status_code==200


def test_student_id_normalizes_spaces_and_typographic_dashes(client):
    with patch('web.app.extract_face', return_value=np.zeros((160,160),dtype=np.uint8)):
        result=client.post('/api/enroll',headers=HEADERS,json={'id':' STU –006 ','name':'Test Student','consent':True,'images':['image']*3})
    assert result.status_code==200
    assert result.json()['student']['id']=='STU-006'
    assert client.get('/api/session').json()['students'][0]['id']=='STU-006'


def test_separate_training_and_gallery_are_session_isolated(client):
    sample = np.random.default_rng(9).integers(0, 256, (160, 160), dtype=np.uint8)
    assert client.post('/api/train', headers=HEADERS).status_code == 409
    with patch('web.app.extract_face', return_value=sample):
        result = client.post('/api/enroll', headers=HEADERS, json={
            'id': 'S1', 'name': ' Student One ', 'department': ' Science ',
            'roll_number': 'R1', 'course': 'BSc', 'consent': True,
            'images': ['image'] * 3, 'train': False})
        assert result.status_code == 200
        state = client.get('/api/session').json()
        assert not state['model_ready'] and state['sample_count'] == 3
        assert state['students'][0]['name'] == 'Student One'
        assert state['students'][0]['roll_number'] == 'R1'
        assert client.post('/api/recognize', headers=HEADERS,
                           json={'image': 'image', 'consent': True}).status_code == 409
        gallery = client.get('/api/photos').json()['groups']
        assert len(gallery) == 1 and len(gallery[0]['images']) == 3
        decoded = Image.open(io.BytesIO(base64.b64decode(gallery[0]['images'][0].split(',')[1])))
        assert decoded.size == (160, 160)
        other = TestClient(app, base_url='https://testserver')
        assert other.get('/api/photos').json()['groups'] == []
        assert client.post('/api/train', headers=HEADERS).status_code == 200
        assert client.get('/api/session').json()['model_ready']
        match = client.post('/api/recognize', headers=HEADERS,
                            json={'image': 'image', 'consent': True}).json()
        assert match['matched'] and match['student']['id'] == 'S1'


def test_student_edits_invalidate_pending_but_preserve_attendance(client):
    sample = np.zeros((160, 160), dtype=np.uint8)
    with patch('web.app.extract_face', return_value=sample):
        enroll(client)
        match = client.post('/api/recognize', headers=HEADERS,
                            json={'image': 'image', 'consent': True}).json()
        client.post('/api/attendance', headers=HEADERS, json={'token': match['token']})
        match = client.post('/api/recognize', headers=HEADERS,
                            json={'image': 'image', 'consent': True}).json()
        updated = client.put('/api/students/S1', headers=HEADERS,
                             json={'name': 'Corrected Name', 'department': 'Math', 'roll_number': 'R2'})
        assert updated.status_code == 200
        assert updated.json()['student']['sample_count'] == 3
        assert client.post('/api/attendance', headers=HEADERS,
                           json={'token': match['token']}).status_code == 409
        state = client.get('/api/session').json()
        assert state['students'][0]['name'] == 'Corrected Name'
        assert state['attendance'][0]['name'] == 'Student One'
        assert state['model_ready']
        assert client.put('/api/students/S1', headers=HEADERS, json={'name': '   '}).status_code == 422
        assert client.put('/api/students/missing', headers=HEADERS, json={'name': 'Test'}).status_code == 404


def test_removal_retrains_label_mapping_and_preserves_records(client):
    first = np.random.default_rng(2).integers(0, 256, (160, 160), dtype=np.uint8)
    second = np.zeros((160, 160), dtype=np.uint8)
    with patch('web.app.extract_face', return_value=first):
        enroll(client)
        match = client.post('/api/recognize', headers=HEADERS,
                            json={'image': 'image', 'consent': True}).json()
        client.post('/api/attendance', headers=HEADERS, json={'token': match['token']})
    with patch('web.app.extract_face', return_value=second):
        client.post('/api/enroll', headers=HEADERS, json={
            'id': 'S2', 'name': 'Student Two', 'consent': True, 'images': ['image'] * 3})
        match = client.post('/api/recognize', headers=HEADERS,
                            json={'image': 'image', 'consent': True}).json()
        assert client.delete('/api/students/S1', headers=HEADERS).status_code == 200
        state = client.get('/api/session').json()
        assert not state['model_ready'] and len(state['attendance']) == 1
        assert state['sample_count'] == 3
        assert client.post('/api/attendance', headers=HEADERS,
                           json={'token': match['token']}).status_code == 409
        assert client.post('/api/recognize', headers=HEADERS,
                           json={'image': 'image', 'consent': True}).status_code == 409
        client.post('/api/train', headers=HEADERS)
        match = client.post('/api/recognize', headers=HEADERS,
                            json={'image': 'image', 'consent': True}).json()
        assert match['student']['id'] == 'S2'
        assert client.delete('/api/students/S1', headers=HEADERS).status_code == 404


def test_student_and_training_mutations_enforce_session_boundaries(client):
    with patch('web.app.extract_face', return_value=np.zeros((160, 160), dtype=np.uint8)):
        enroll(client)
    other = TestClient(app, base_url='https://testserver')
    assert other.put('/api/students/S1', headers=HEADERS, json={'name': 'Wrong'}).status_code == 404
    assert other.delete('/api/students/S1', headers=HEADERS).status_code == 404
    assert other.post('/api/train', headers=HEADERS).status_code == 409
    assert client.post('/api/train').status_code == 403
    assert client.put('/api/students/S1', json={'name': 'Wrong'}).status_code == 403
    assert client.delete('/api/students/S1').status_code == 403
    assert client.get('/api/session').json()['students'][0]['name'] == 'Student One'
