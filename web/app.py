"""Session-isolated, ephemeral browser demonstration of OpenCV LBPH attendance."""
import asyncio
import base64
from contextlib import asynccontextmanager, suppress
import csv
import io
import os
import secrets
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from PIL import Image, UnidentifiedImageError

ROOT = Path(__file__).resolve().parent
TTL = 1800
MAX_SESSIONS = 16
LOCK = threading.RLock()
SESSIONS = {}
cv2.setNumThreads(1)
DETECTOR = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
def expire_sessions():
    with LOCK:
        now = time.monotonic()
        for token in list(SESSIONS):
            if now - SESSIONS[token]['touched'] > TTL:
                del SESSIONS[token]


@asynccontextmanager
async def lifespan(app):
    async def cleanup():
        while True:
            await asyncio.sleep(60)
            expire_sessions()
    task = asyncio.create_task(cleanup())
    yield
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task
    SESSIONS.clear()


app = FastAPI(title='Vision Attend', docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


class BodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        size = 0
        messages = []
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                return
            size += len(message.get('body', b''))
            if size > 2_000_000:
                return await Response('Image request too large', status_code=413)(scope, receive, send)
            messages.append(message)
            if not message.get('more_body', False):
                break
        async def bounded_receive():
            if messages:
                return messages.pop(0)
            return await receive()
        await self.app(scope, bounded_receive, send)


app.add_middleware(BodyLimit)


@app.middleware('http')
async def protections(request, call_next):
    if request.method not in ('GET', 'HEAD', 'OPTIONS') and request.headers.get('x-vision-request') != '1':
        return Response('Use the application to submit requests', status_code=403)
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Permissions-Policy'] = 'camera=(self), microphone=()'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    return response


def session(request, response):
    now = time.monotonic()
    with LOCK:
        for token in list(SESSIONS):
            if now - SESSIONS[token]['touched'] > TTL:
                del SESSIONS[token]
        token = request.cookies.get('vision_session', '')
        if token not in SESSIONS:
            if len(SESSIONS) >= MAX_SESSIONS:
                raise HTTPException(503, 'The demo is at capacity. Please try again later.')
            token = secrets.token_urlsafe(32)
            SESSIONS[token] = {'students': [], 'attendance': [], 'model': None, 'pending': None, 'touched': now}
        data = SESSIONS[token]
        data['touched'] = now
        response.set_cookie('vision_session', token, httponly=True, secure=os.getenv('COOKIE_SECURE', 'true') == 'true', samesite='strict', max_age=TTL)
        return data


def extract_face(encoded):
    try:
        prefix, raw = encoded.split(',', 1)
        if prefix not in ('data:image/jpeg;base64', 'data:image/png;base64'):
            raise ValueError()
        content = base64.b64decode(raw, validate=True)
        with Image.open(io.BytesIO(content)) as picture:
            if picture.width * picture.height > 4_000_000:
                raise ValueError()
            picture.thumbnail((800, 800))
            gray = np.array(picture.convert('L'))
    except (ValueError, UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(422, 'Use a JPEG or PNG image of at most 4 megapixels.')
    faces = DETECTOR.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(65, 65))
    if len(faces) != 1:
        raise HTTPException(422, 'Exactly one clear, front-facing face is required. Improve lighting and try again.')
    x, y, w, h = faces[0]
    return cv2.equalizeHist(cv2.resize(gray[y:y+h, x:x+w], (160, 160)))


def public_student(student):
    return {key: student[key] for key in ('id', 'name', 'department')}


class Enrollment(BaseModel):
    id: str = Field(min_length=1, max_length=40, pattern=r'^[A-Za-z0-9_-]+$')
    name: str = Field(min_length=1, max_length=80)
    department: str = Field(default='', max_length=80)
    consent: bool
    images: list[str] = Field(min_length=3, max_length=3)

    @field_validator('id', mode='before')
    @classmethod
    def normalize_id(cls, value):
        if isinstance(value, str):
            return ''.join(value.split()).translate(str.maketrans({'–': '-', '—': '-', '−': '-'}))
        return value


class Capture(BaseModel):
    image: str = Field(max_length=700000)
    consent: bool


class Confirmation(BaseModel):
    token: str = Field(max_length=100)


@app.get('/')
def index():
    return FileResponse(ROOT / 'static/index.html')


@app.get('/health')
def health():
    return {'status': 'ok', 'service': 'vision-attend'}


@app.get('/api/session')
def state(request: Request, response: Response):
    with LOCK:
        data = session(request, response)
        return {'students': [public_student(s) for s in data['students']], 'attendance': data['attendance'], 'expires_after_minutes': 30}


@app.post('/api/enroll')
def enroll(payload: Enrollment, request: Request, response: Response):
    if not payload.consent:
        raise HTTPException(422, 'Consent is required to process face images.')
    if not payload.name.strip():
        raise HTTPException(422, 'Enter a student name.')
    with LOCK:
        data = session(request, response)
        if len(data['students']) >= 10:
            raise HTTPException(409, 'This demo supports 10 students per session.')
        if any(s['id'] == payload.id for s in data['students']):
            raise HTTPException(409, 'This student ID is already enrolled.')
        samples = [extract_face(img) for img in payload.images]
        student = {'id': payload.id, 'name': payload.name.strip(), 'department': payload.department.strip(), 'samples': samples}
        students = data['students'] + [student]
        faces, labels = [], []
        for label, item in enumerate(students):
            faces.extend(item['samples'])
            labels.extend([label] * len(item['samples']))
        model = cv2.face.LBPHFaceRecognizer_create()
        model.train(faces, np.array(labels, dtype=np.int32))
        data['students'], data['model'], data['pending'] = students, model, None
        return {'student': public_student(student), 'samples': 3}


@app.post('/api/recognize')
def recognize(payload: Capture, request: Request, response: Response):
    if not payload.consent:
        raise HTTPException(422, 'Consent is required to process face images.')
    with LOCK:
        data = session(request, response)
        data['pending'] = None
        if data['model'] is None:
            raise HTTPException(409, 'Enroll a student with three photos first.')
        face = extract_face(payload.image)
        label, distance = data['model'].predict(face)
        if distance > 65:
            return {'matched': False, 'message': 'No sufficiently close match. Attendance was not recorded.'}
        student = public_student(data['students'][label])
        token = secrets.token_urlsafe(24)
        data['pending'] = {'token': token, 'student': student, 'created': time.monotonic()}
        return {'matched': True, 'student': student, 'distance': round(distance, 2), 'token': token}


@app.post('/api/attendance')
def confirm(payload: Confirmation, request: Request, response: Response):
    with LOCK:
        data = session(request, response)
        pending = data['pending']
        if not pending or pending['token'] != payload.token or time.monotonic() - pending['created'] > 120:
            raise HTTPException(409, 'Recognition expired. Capture a new image.')
        student = pending['student']
        timestamp = datetime.now(timezone.utc)
        date = timestamp.date().isoformat()
        data['pending'] = None
        if any(row['id'] == student['id'] and row['date'] == date for row in data['attendance']):
            return {'message': 'Already marked present today (UTC).'}
        data['attendance'].append({**student, 'date': date, 'time': timestamp.strftime('%H:%M:%S'), 'status': 'Present'})
        return {'message': 'Attendance confirmed and recorded.'}


def csv_safe(value):
    value = str(value)
    return "'" + value if value.lstrip().startswith(('=', '+', '-', '@')) or value.startswith(('\t', '\r', '\n')) else value


@app.get('/api/export')
def export(request: Request, response: Response):
    with LOCK:
        data = session(request, response)
        output = io.StringIO()
        columns = ['id', 'name', 'department', 'date', 'time', 'status']
        writer = csv.writer(output)
        writer.writerow(columns)
        writer.writerows([[csv_safe(row[c]) for c in columns] for row in data['attendance']])
        response.status_code = 200
        response.body = output.getvalue().encode()
        response.headers['content-type'] = 'text/csv; charset=utf-8'
        response.headers['content-disposition'] = 'attachment; filename="vision-attend.csv"'
        response.headers['content-length'] = str(len(response.body))
        return response


@app.delete('/api/session')
def clear(request: Request, response: Response):
    with LOCK:
        SESSIONS.pop(request.cookies.get('vision_session', ''), None)
    response.delete_cookie('vision_session')
    return {'message': 'Session records and face samples deleted.'}


app.mount('/static', StaticFiles(directory=ROOT / 'static'), name='static')
