"""Project information window for vision-attend."""
from tkinter import Tk, Label


class Developer:
    def __init__(self, root):
        self.root = root
        root.title("vision-attend | About")
        root.geometry("700x320")
        Label(root, text="vision-attend", font=("Arial", 28, "bold")).pack(pady=24)
        Label(root, text="Desktop student records, face-model training, and attendance tools.",
              wraplength=620, font=("Arial", 14)).pack(pady=12)
        Label(root, text="Documentation and issues:\ngithub.com/quixoticalcoder/vision-attend",
              font=("Arial", 12)).pack(pady=16)


if __name__ == "__main__":
    root = Tk()
    Developer(root)
    root.mainloop()
