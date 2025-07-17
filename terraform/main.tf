resource "aws_instance" "logalyze_instance" {
  ami                    = "ami-0c02fb55956c7d316" # Ubuntu 22.04 LTS
  instance_type          = var.instance_type
  key_name               = var.key_name

  tags = {
    Name = var.project_name
  }

  vpc_security_group_ids = [aws_security_group.allow_http.id]

  user_data = <<-EOF
              #!/bin/bash
              apt update -y
              apt install -y docker.io unzip
              systemctl start docker
              systemctl enable docker

              cd /home/ubuntu
              mkdir logalyze
              cd logalyze

              # Assuming you'll SCP your zipped app
              unzip log.zip
              docker build -t logalyze .
              docker run -d --restart always -p 80:3000 --env-file .env logalyze
              EOF
}

resource "aws_security_group" "allow_http" {
  name = "logalyze-allow-http"

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
