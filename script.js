const canvas = document.querySelector('#canva');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
console.log(window.innerHeight);

if (window.innerWidth < 1000) {
  canvas.height = 1223;
}

document.querySelector('#canva').style.height = document.body.scrollHeight+'px';

console.log(window.innerHeight);
const ctx = canvas.getContext('2d');
const lingrad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
ctx.strokeStyle = lingrad;
ctx.lineWidth = 2;
lingrad.addColorStop(0, 'blue');
lingrad.addColorStop(0.2, '#8338ec');
lingrad.addColorStop(0.4, 'yellow');
lingrad.addColorStop(0.6, 'cyan');
lingrad.addColorStop(0.8, '#ff0054');
lingrad.addColorStop(1, 'red');

class Element {
  constructor(x, y, canvasWidth, canvasHeight, size) {
    this.x = x;
    this.y = y;
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.size = size;
    this.startAngle = 0;
    this.endAngle = 360;
  }

  draw(ctx) {
    ctx.strokeStyle = '';
    ctx.beginPath();
    ctx.arc(
      this.x,
      this.y,
      this.size,
      (Math.PI / 180) * this.startAngle,
      (Math.PI / 180) * this.endAngle,
      true,
    );
    // if (this.startAngle > 175 && this.endAngle < 180) {
    //   this.startAngle = 0;
    //   this.endAngle = 365;

    // }

    if (this.x > this.canvasWidth && this.y > this.canvasHeight) {
      const xAxis = Math.random() * this.canvasWidth;
      const yAxis = Math.random() * this.canvasHeight;

      this.x = xAxis;
      this.y = yAxis;
    } else {
      this.x += 1;
      this.y += 1;
      // this.startAngle += 1;
      // this.endAngle -= 1;
    }
    ctx.stroke();
  }
}

class Elements {
  constructor(canvasWidth, canvasHeight) {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.size = canvasWidth / 100;
    this.elements = [];
    this.#initalizeElements();
  }

  resize(Width, Height) {
    this.canvasWidth = Width;
    this.canvasHeight = Height;
    this.size = canvasWidth / 100;
    this.elements = [];
    this.#initalizeElements();
  }

  #initalizeElements() {
    for (let i = 0; i < 200; i++) {
      this.elements[i] = new Element(
        Math.floor(Math.random() * (this.canvasWidth + 40) - 40),
        Math.floor(Math.random() * (this.canvasWidth + 40) - 40),
        this.canvasWidth,
        this.canvasHeight,
        this.size,
      );
    }
  }
}

const elemets = new Elements(canvas.width, canvas.height);

let lastTime = 0;
const fps = 260;
const nextFrame = 1000 / fps;
let timer = 0;

function animate(timeStamp) {
  const deltaTime = timeStamp - lastTime;
  lastTime = timeStamp;
  if (timer > nextFrame) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.02)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    elemets.elements.forEach((elemet) => {
      elemet.draw(ctx);
    });
    timer = 0;
  } else {
    timer += deltaTime;
  }

  requestAnimationFrame(animate);
}

animate(0);
