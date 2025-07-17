variable "aws_region" {
  default = "us-east-1"
}

variable "key_name" {
  description = "Name of the existing EC2 key pair"
}

variable "instance_type" {
  default = "t2.micro"
}

variable "project_name" {
  default = "logalyze"
}
